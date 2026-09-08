import type { LocalResult } from './model.ts';
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { LOCAL_MODEL } from './model.ts';
import { downloadModel, verifyModel } from './download.ts';
import { LocalEngine } from './engine.ts';

export const localSupported = process.platform === 'darwin' && process.arch === 'arm64';
const directory = (): string => join(app.getPath('userData'), 'models');
const modelPath = (): string => join(directory(), LOCAL_MODEL.file);
let controller: AbortController | undefined;
let engine: LocalEngine | undefined;
let verified = false;
let working = false;
let phase = 'idle';
let bytes = 0;
let error = '';
const listeners = new Set<() => void>();

export interface LocalState {
  supported: boolean;
  installed: boolean;
  phase: string;
  bytes: number;
  total: number;
  error: string;
  path: string;
  busy: boolean;
}
export function localState(): LocalState {
  let installed = false;
  try {
    installed = existsSync(modelPath()) && statSync(modelPath()).size === LOCAL_MODEL.bytes;
  } catch {
    /* missing */
  }
  return {
    supported: localSupported,
    installed,
    phase,
    bytes,
    total: LOCAL_MODEL.bytes,
    error,
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

export async function installLocal(): Promise<void> {
  if (!localSupported) throw new Error('Offline translation requires an Apple Silicon Mac.');
  if (working || controller) throw new Error('The model is busy. Please wait and try again.');
  controller = new AbortController();
  phase = 'downloading';
  error = '';
  bytes = 0;
  emit();
  let lastUpdate = 0;
  try {
    await downloadModel(directory(), controller.signal, (downloaded, verifying) => {
      bytes = downloaded;
      phase = verifying ? 'verifying' : 'downloading';
      if (verifying || Date.now() - lastUpdate > 150) {
        lastUpdate = Date.now();
        emit();
      }
    });
    verified = true;
    phase = 'ready';
  } catch (cause) {
    phase = 'idle';
    error = controller.signal.aborted
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
export async function deleteLocal(): Promise<void> {
  if (working || controller)
    throw new Error('The model is busy. Wait for it to finish before deleting.');
  working = true;
  emit();
  try {
    await engine?.release();
    engine = undefined;
    verified = false;
    await rm(modelPath(), { force: true });
    phase = 'idle';
    error = '';
    bytes = 0;
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
): Promise<LocalResult> {
  if (!localSupported) throw new Error('Offline translation requires an Apple Silicon Mac.');
  if (working || controller)
    throw new Error('The offline model is busy. Please wait and try again.');
  if (!localState().installed)
    throw new Error('Download the model in Settings → Offline Translation (1.13 GB).');
  working = true;
  phase = 'translating';
  error = '';
  emit();
  try {
    if (!verified) {
      verified = await verifyModel(modelPath(), signal);
      if (!verified) throw new Error('The model is corrupted. Delete it and download it again.');
    }
    engine ??= new LocalEngine(modelPath());
    return await engine.translate(text, primary, secondary, signal, onChunk);
  } finally {
    working = false;
    phase = 'ready';
    emit();
  }
}
export function shutdownLocal(): void {
  cancelLocalDownload();
  void engine?.release().then(emit);
}

export async function warmLocal(): Promise<void> {
  if (!localSupported || !localState().installed || working || controller) return;
  working = true;
  phase = 'loading';
  error = '';
  emit();
  try {
    if (!verified) verified = await verifyModel(modelPath());
    if (!verified) throw new Error('The model is corrupted. Delete it and download it again.');
    engine ??= new LocalEngine(modelPath());
    await engine.warmup();
    phase = 'ready';
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    phase = 'idle';
  } finally {
    working = false;
    emit();
  }
}
export function releaseLocal(): void {
  void engine?.release().then(emit);
}
