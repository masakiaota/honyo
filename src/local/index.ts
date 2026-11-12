import type { LocalResult } from './model.ts';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { getLocalModel, LOCAL_MODEL_ID } from './model.ts';
import { downloadModel, verifyModel } from './download.ts';
import { MlxEngine } from './mlx-engine.ts';

export const localSupported = process.platform === 'darwin' && process.arch === 'arm64';
const directory = (): string => join(app.getPath('userData'), 'models');
const modelPath = (id: string): string => join(directory(), getLocalModel(id).file);
let controller: AbortController | undefined;
let engine: MlxEngine | undefined;
let engineId: string | undefined;
let releasing: Promise<void> = Promise.resolve();
const verified = new Set<string>();
// Install/delete own the model directory exclusively. Translations and warmups
// share the engine, which serializes them, so they wait rather than fail.
let deleting = false;
let translations = 0;
let warming: { id: string; promise: Promise<void> } | undefined;
const VERIFY_TIMEOUT_MS = 10 * 60_000;
let releaseVersion = 0;
const progress = new Map<string, { phase: string; bytes: number; error: string }>();
const listeners = new Set<() => void>();

function mlxHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mlx', 'honyo-mlx')
    : join(app.getAppPath(), 'build', 'mlx', 'honyo-mlx');
}
function assertEngineAvailable(): void {
  if (!existsSync(mlxHelperPath()))
    throw new Error(
      'The MLX helper is missing. Rebuild the app with npm run build:mlx or reinstall it.',
    );
}
function status(id: string): { phase: string; bytes: number; error: string } {
  getLocalModel(id);
  const existing = progress.get(id);
  if (existing) return existing;
  const state = { phase: 'idle', bytes: 0, error: '' };
  progress.set(id, state);
  return state;
}
export interface LocalState {
  id: string;
  supported: boolean;
  installed: boolean;
  phase: string;
  bytes: number;
  total: number;
  error: string;
  path: string;
  busy: boolean;
}
export function localState(id = LOCAL_MODEL_ID): LocalState {
  const model = getLocalModel(id);
  let installed = false;
  try {
    installed = model.assets.every(
      asset => statSync(join(modelPath(id), asset.file)).size === asset.bytes,
    );
  } catch {
    /* missing */
  }
  return {
    id,
    supported: localSupported,
    installed,
    ...status(id),
    total: model.bytes,
    path: directory(),
    busy: deleting || !!controller || translations > 0 || !!warming,
  };
}
export function subscribeLocal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(): void {
  for (const listener of listeners) listener();
}
function assertSupported(): void {
  if (!localSupported) throw new Error('Offline translation requires an Apple Silicon Mac.');
}
function assertNotManaging(): void {
  if (deleting || controller)
    throw new Error('The offline model is busy. Please wait and try again.');
}
function assertIdle(): void {
  assertSupported();
  assertNotManaging();
  if (translations > 0 || warming)
    throw new Error('The offline model is busy. Please wait and try again.');
}
/** Waits for a pending warmup; an abort stops only this caller's wait. */
function waitForWarmup(signal?: AbortSignal): Promise<void> {
  const pending = warming?.promise;
  if (!pending) return Promise.resolve();
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('Offline translation cancelled.'),
      );
    signal.addEventListener('abort', onAbort, { once: true });
    void pending.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}
// Selecting, releasing and submitting work to an engine happen under one lock, so a
// request can never reach an engine that another caller is replacing (which would
// spawn a helper nobody owns). Work is submitted, not awaited, inside the lock.
let engineLock: Promise<unknown> = Promise.resolve();
function withEngine<T>(
  id: string,
  signal: AbortSignal | undefined,
  submit: (engine: MlxEngine) => Promise<T>,
): Promise<T> {
  const run = async (): Promise<{ result: Promise<T> }> => {
    const result = submit(await getEngine(id, signal));
    void result.catch(() => undefined);
    return { result };
  };
  const locked = engineLock.then(run, run);
  engineLock = locked.catch(() => undefined);
  return locked.then(({ result }) => result);
}
async function getEngine(id: string, signal?: AbortSignal): Promise<MlxEngine> {
  const version = releaseVersion;
  assertEngineAvailable();
  await releasing;
  if (engineId !== id) {
    await engine?.release();
    engine = undefined;
    engineId = undefined;
  }
  if (!verified.has(id)) {
    const bounded = AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    ]);
    if (!(await verifyModel(modelPath(id), bounded, getLocalModel(id))))
      throw new Error('The model is corrupted. Delete it and download it again.');
    verified.add(id);
  }
  if (version !== releaseVersion) throw new Error('Offline model selection changed.');
  signal?.throwIfAborted();
  engine ??= new MlxEngine(modelPath(id), mlxHelperPath());
  engineId = id;
  return engine;
}
export async function installLocal(id = LOCAL_MODEL_ID): Promise<void> {
  const model = getLocalModel(id);
  assertIdle();
  assertEngineAvailable();
  controller = new AbortController();
  const state = status(id);
  Object.assign(state, { phase: 'downloading', error: '', bytes: 0 });
  emit();
  let lastUpdate = 0;
  try {
    await downloadModel(
      directory(),
      controller.signal,
      (downloaded, verifying) => {
        state.bytes = downloaded;
        state.phase = verifying ? 'verifying' : 'downloading';
        if (verifying || Date.now() - lastUpdate > 150) {
          lastUpdate = Date.now();
          emit();
        }
      },
      model,
    );
    verified.add(id);
    state.phase = 'ready';
  } catch (cause) {
    state.phase = 'idle';
    state.error = controller.signal.aborted
      ? 'Download cancelled. Retry to download from the beginning.'
      : cause instanceof Error
        ? cause.message
        : String(cause);
    throw cause;
  } finally {
    controller = undefined;
    emit();
  }
}
export function cancelLocalDownload(): void {
  controller?.abort();
}
export async function deleteLocal(id = LOCAL_MODEL_ID): Promise<void> {
  const state = status(id);
  assertIdle();
  deleting = true;
  emit();
  try {
    await releasing;
    if (engineId === id) {
      await engine?.release();
      engine = undefined;
      engineId = undefined;
    }
    verified.delete(id);
    // getLocalModel accepts only the fixed registry; never remove a caller-supplied path.
    await rm(modelPath(id), { recursive: true, force: true });
    Object.assign(state, { phase: 'idle', error: '', bytes: 0 });
  } finally {
    deleting = false;
    emit();
  }
}
export async function translateLocal(
  text: string,
  primary: string,
  secondary: string,
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
  id = LOCAL_MODEL_ID,
): Promise<LocalResult> {
  const state = status(id);
  assertSupported();
  assertNotManaging();
  if (!localState(id).installed)
    throw new Error('Download this model in Settings → Offline Translation.');
  ++translations;
  Object.assign(state, { phase: 'translating', error: '' });
  emit();
  try {
    // A request during startup or settings warmup waits for the model instead
    // of failing as busy. Loading and inference have their own engine deadlines.
    await waitForWarmup(signal);
    assertNotManaging();
    return await withEngine(id, signal, value =>
      value.translate(text, primary, secondary, signal, onChunk),
    );
  } catch (cause) {
    if (!signal?.aborted) state.error = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    --translations;
    if (translations === 0 && !warming) state.phase = 'ready';
    emit();
  }
}
export function shutdownLocal(): void {
  cancelLocalDownload();
  releaseLocal();
}
export async function warmLocal(id = LOCAL_MODEL_ID, targetLanguage = 'Japanese'): Promise<void> {
  if (!localSupported || deleting || controller || !localState(id).installed) return;
  if (warming?.id === id) return warming.promise;
  const previous = warming?.promise ?? Promise.resolve();
  const promise = previous.then(() => runWarmup(id, targetLanguage));
  const entry = { id, promise };
  warming = entry;
  void promise.then(() => {
    if (warming === entry) warming = undefined;
    emit();
  });
  return promise;
}
/** Never rejects: the failure is recorded in the model state. */
async function runWarmup(id: string, targetLanguage: string): Promise<void> {
  const state = status(id);
  if (deleting || controller || !localState(id).installed) return;
  Object.assign(state, { phase: 'loading', error: '' });
  emit();
  try {
    await withEngine(id, undefined, value => value.warmup(targetLanguage));
    state.phase = 'ready';
  } catch (cause) {
    state.error = cause instanceof Error ? cause.message : String(cause);
    state.phase = 'idle';
  } finally {
    emit();
  }
}
export function releaseLocal(): void {
  releaseVersion++;
  const previous = engine;
  engine = undefined;
  engineId = undefined;
  releasing = Promise.all([releasing, previous?.release()]).then(() => undefined);
  // Observe rejection without clearing the barrier: uncertain process shutdown
  // must never allow a second resident model to be spawned. Restart the app to recover.
  void releasing.then(emit, () => {
    console.error('Offline engine shutdown could not be confirmed. Restart the app to recover.');
    emit();
  });
}
