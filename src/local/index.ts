import type { LocalResult } from './model.ts';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { getLocalModel, LOCAL_MODEL_ID } from './model.ts';
import { downloadModel, verifyModel } from './download.ts';
import { LocalEngine } from './engine.ts';
import { MlxEngine } from './mlx-engine.ts';

export const localSupported = process.platform === 'darwin' && process.arch === 'arm64';
const directory = (): string => join(app.getPath('userData'), 'models');
const modelPath = (id: string): string => join(directory(), getLocalModel(id).file);
let controller: AbortController | undefined;
type TranslationEngine = Pick<LocalEngine, 'translate' | 'warmup' | 'release'>;
let engine: TranslationEngine | undefined;
let engineId: string | undefined;
let releasing: Promise<void> = Promise.resolve();
const verified = new Set<string>();
let working = false;
let operationController: AbortController | undefined;
let releaseVersion = 0;
const progress = new Map<string, { phase: string; bytes: number; error: string }>();
const listeners = new Set<() => void>();

function mlxHelperPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mlx', 'honyo-mlx')
    : join(app.getAppPath(), 'build', 'mlx', 'honyo-mlx');
}
function assertEngineAvailable(id: string): void {
  if (getLocalModel(id).engine === 'mlx' && !existsSync(mlxHelperPath()))
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
    installed = model.assets
      ? model.assets.every(asset => statSync(join(modelPath(id), asset.file)).size === asset.bytes)
      : existsSync(modelPath(id)) && statSync(modelPath(id)).size === model.bytes;
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
    busy: working || !!controller,
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
  if (working || controller)
    throw new Error('The offline model is busy. Please wait and try again.');
}
async function getEngine(id: string, signal?: AbortSignal): Promise<TranslationEngine> {
  const version = releaseVersion;
  assertEngineAvailable(id);
  await releasing;
  if (engineId !== id) {
    await engine?.release();
    engine = undefined;
    engineId = undefined;
  }
  if (!verified.has(id)) {
    if (!(await verifyModel(modelPath(id), signal, getLocalModel(id))))
      throw new Error('The model is corrupted. Delete it and download it again.');
    verified.add(id);
  }
  if (version !== releaseVersion) throw new Error('Offline model selection changed.');
  signal?.throwIfAborted();
  engine ??=
    getLocalModel(id).engine === 'mlx'
      ? new MlxEngine(modelPath(id), mlxHelperPath(), getLocalModel(id).template)
      : new LocalEngine(modelPath(id), getLocalModel(id));
  engineId = id;
  return engine;
}
export async function installLocal(id = LOCAL_MODEL_ID): Promise<void> {
  const model = getLocalModel(id);
  assertAvailable();
  assertEngineAvailable(id);
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
  assertAvailable();
  working = true;
  emit();
  try {
    await releasing;
    if (engineId === id) {
      await engine?.release();
      engine = undefined;
      engineId = undefined;
    }
    verified.delete(id);
    const model = getLocalModel(id);
    // getLocalModel accepts only the fixed registry; never remove a caller-supplied path.
    await rm(modelPath(id), model.assets ? { recursive: true, force: true } : { force: true });
    Object.assign(state, { phase: 'idle', error: '', bytes: 0 });
  } finally {
    working = false;
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
  assertAvailable();
  if (!localState(id).installed)
    throw new Error('Download this model in Settings → Offline Translation.');
  working = true;
  operationController = new AbortController();
  Object.assign(state, { phase: 'translating', error: '' });
  emit();
  try {
    const bounded = AbortSignal.any([
      operationController.signal,
      ...(signal ? [signal] : []),
      AbortSignal.timeout(90_000),
    ]);
    return await (
      await getEngine(id, bounded)
    ).translate(text, primary, secondary, bounded, onChunk);
  } catch (cause) {
    state.error = cause instanceof Error ? cause.message : String(cause);
    throw cause;
  } finally {
    working = false;
    state.phase = 'ready';
    operationController = undefined;
    emit();
  }
}
export function shutdownLocal(): void {
  cancelLocalDownload();
  releaseLocal();
}
export async function warmLocal(id = LOCAL_MODEL_ID, targetLanguage = 'Japanese'): Promise<void> {
  const state = status(id);
  if (!localSupported || !localState(id).installed || working || controller) return;
  working = true;
  operationController = new AbortController();
  Object.assign(state, { phase: 'loading', error: '' });
  emit();
  try {
    const bounded = AbortSignal.any([operationController.signal, AbortSignal.timeout(90_000)]);
    await (await getEngine(id, bounded)).warmup(targetLanguage, bounded);
    state.phase = 'ready';
  } catch (cause) {
    state.error = cause instanceof Error ? cause.message : String(cause);
    state.phase = 'idle';
  } finally {
    working = false;
    operationController = undefined;
    emit();
  }
}
export function releaseLocal(): void {
  releaseVersion++;
  operationController?.abort(new Error('The offline model was released.'));
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
