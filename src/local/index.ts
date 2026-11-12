import type { LocalResult } from './model.ts';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { getLocalModel, LOCAL_MODEL_ID } from './model.ts';
import { downloadModel } from './download.ts';
import { MlxEngine } from './mlx-engine.ts';

export const localSupported = process.platform === 'darwin' && process.arch === 'arm64';
const directory = (): string => join(app.getPath('userData'), 'models');
const modelPath = (id: string): string => join(directory(), getLocalModel(id).file);
let controller: AbortController | undefined;
let engine: MlxEngine | undefined;
let engineId: string | undefined;
let releasing: Promise<void> = Promise.resolve();
// Model work (warmup, translation, deletion) runs one at a time. A request made
// during a warmup waits for it instead of failing as busy. Helper work is bounded
// by the engine's loading and inference deadlines.
let working = 0;
let tail: Promise<unknown> = Promise.resolve();
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
    busy: working > 0 || !!controller,
  };
}
export function subscribeLocal(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit(): void {
  for (const listener of listeners) listener();
}
function assertAvailable(): void {
  if (!localSupported) throw new Error('Offline translation requires an Apple Silicon Mac.');
  if (controller) throw new Error('The offline model is busy. Please wait and try again.');
}
function serial<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  ++working;
  emit();
  const run = async (): Promise<T> => {
    try {
      // A request cancelled while queued leaves no trace.
      signal?.throwIfAborted();
      return await task();
    } finally {
      --working;
      emit();
    }
  };
  const result = tail.then(run);
  tail = result.catch(() => undefined);
  return result;
}
/** `version` is captured when the request is made, so a release while queued cancels it. */
async function getEngine(id: string, version: number, signal?: AbortSignal): Promise<MlxEngine> {
  assertEngineAvailable();
  await releasing;
  if (engineId !== id) {
    await engine?.release();
    engine = undefined;
    engineId = undefined;
  }
  if (version !== releaseVersion) throw new Error('Offline model selection changed.');
  signal?.throwIfAborted();
  engine ??= new MlxEngine(modelPath(id), mlxHelperPath());
  engineId = id;
  return engine;
}
export async function installLocal(id = LOCAL_MODEL_ID): Promise<void> {
  const model = getLocalModel(id);
  assertAvailable();
  if (working > 0) throw new Error('The offline model is busy. Please wait and try again.');
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
export function deleteLocal(id = LOCAL_MODEL_ID): Promise<void> {
  const state = status(id);
  assertAvailable();
  return serial(async () => {
    await releasing;
    if (engineId === id) {
      await engine?.release();
      engine = undefined;
      engineId = undefined;
    }
    // getLocalModel accepts only the fixed registry; never remove a caller-supplied path.
    await rm(modelPath(id), { recursive: true, force: true });
    Object.assign(state, { phase: 'idle', error: '', bytes: 0 });
  });
}
export function translateLocal(
  text: string,
  primary: string,
  secondary: string,
  signal?: AbortSignal,
  onChunk?: (text: string) => void,
  id = LOCAL_MODEL_ID,
): Promise<LocalResult> {
  const state = status(id);
  assertAvailable();
  if (!localState(id).installed)
    throw new Error('Download this model in Settings → Offline Translation.');
  const version = releaseVersion;
  return serial(async () => {
    Object.assign(state, { phase: 'translating', error: '' });
    emit();
    try {
      return await (
        await getEngine(id, version, signal)
      ).translate(text, primary, secondary, signal, onChunk);
    } catch (cause) {
      if (!signal?.aborted) state.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      state.phase = 'ready';
      emit();
    }
  }, signal);
}
export function shutdownLocal(): void {
  cancelLocalDownload();
  releaseLocal();
}
export async function warmLocal(id = LOCAL_MODEL_ID, targetLanguage = 'Japanese'): Promise<void> {
  const state = status(id);
  if (!localSupported || controller || !localState(id).installed) return;
  const version = releaseVersion;
  return serial(async () => {
    Object.assign(state, { phase: 'loading', error: '' });
    emit();
    try {
      await (await getEngine(id, version)).warmup(targetLanguage);
      state.phase = 'ready';
    } catch (cause) {
      state.error = cause instanceof Error ? cause.message : String(cause);
      state.phase = 'idle';
    }
  });
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
