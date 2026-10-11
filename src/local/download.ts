import type { ReadableStream } from 'node:stream/web';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, stat, statfs } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LOCAL_MODEL, type LocalModel, type LocalModelAsset } from './model.ts';

async function verifyFile(
  path: string,
  model: LocalModelAsset,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    signal?.throwIfAborted();
    if ((await stat(path)).size !== model.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
      signal?.throwIfAborted();
      hash.update(chunk as Buffer);
    }
    signal?.throwIfAborted();
    return hash.digest('hex') === model.sha256;
  } catch (error) {
    signal?.throwIfAborted();
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

/** A directory is valid only when every pinned asset verifies, never just its weights. */
export async function verifyModel(
  path: string,
  signal?: AbortSignal,
  model: LocalModel = LOCAL_MODEL,
): Promise<boolean> {
  if (!model.assets) return verifyFile(path, model, signal);
  validateAssets(model);
  for (const asset of model.assets) {
    if (!(await verifyFile(join(path, asset.file), asset, signal))) return false;
  }
  return true;
}

function validateAssets(model: LocalModel): void {
  const assets = model.assets;
  if (
    !assets?.length ||
    basename(model.file) !== model.file ||
    ['.', '..'].includes(model.file) ||
    new Set(assets.map(asset => asset.file)).size !== assets.length ||
    assets.reduce((sum, asset) => sum + asset.bytes, 0) !== model.bytes ||
    assets.some(
      asset =>
        basename(asset.file) !== asset.file ||
        ['.', '..'].includes(asset.file) ||
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 0 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256),
    )
  )
    throw new Error('Invalid offline model asset manifest.');
}

async function downloadFile(
  partial: string,
  model: LocalModelAsset,
  signal: AbortSignal,
  progress: (bytes: number, verifying: boolean) => void,
): Promise<void> {
  // Apply the bound to the response body too, not only the HTTP headers.
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
  bounded.throwIfAborted();
  const response = await fetch(model.url, { signal: bounded });
  if (!response.ok || !response.body)
    throw new Error(`Model download failed (HTTP ${response.status}). Please try again.`);
  let bytes = 0;
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      bytes += chunk.length;
      if (bytes > model.bytes) {
        callback(new Error('The model size does not match the expected file.'));
        return;
      }
      hash.update(chunk);
      progress(bytes, false);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    meter,
    createWriteStream(partial, { mode: 0o600 }),
    { signal: bounded },
  );
  bounded.throwIfAborted();
  progress(bytes, true);
  if (bytes !== model.bytes || hash.digest('hex') !== model.sha256)
    throw new Error('Model verification failed. Please download it again.');
  bounded.throwIfAborted();
}

/** Only a complete verified model is promoted. Other installed models remain untouched. */
export async function downloadModel(
  directory: string,
  signal: AbortSignal,
  progress: (bytes: number, verifying: boolean) => void,
  model: LocalModel = LOCAL_MODEL,
): Promise<string> {
  if (model.assets) validateAssets(model);
  await mkdir(directory, { recursive: true });
  const destination = join(directory, model.file);
  if (await verifyModel(destination, signal, model)) return destination;
  const space = await statfs(directory);
  if (space.bavail * space.bsize < model.bytes + 256 * 1024 * 1024)
    throw new Error(
      `Not enough disk space. Free at least ${((model.bytes + 256 * 1024 * 1024) / 1e9).toFixed(1)} GB and try again.`,
    );
  if (model.assets) {
    const root = resolve(directory);
    const final = resolve(destination);
    if (dirname(final) !== root) throw new Error('Invalid offline model destination.');
    const staging = await mkdtemp(join(root, `.${model.file}.partial-`));
    if (dirname(resolve(staging)) !== root) throw new Error('Invalid staging destination.');
    try {
      let completed = 0;
      for (const asset of model.assets) {
        await downloadFile(join(staging, asset.file), asset, signal, (bytes, verifying) =>
          progress(completed + bytes, verifying),
        );
        completed += asset.bytes;
      }
      signal.throwIfAborted();
      // Only this known model directory may be replaced, and only after verification.
      await rm(final, { recursive: true, force: true });
      await rename(staging, final);
      return final;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  const partial = destination + '.partial';
  try {
    await downloadFile(partial, model, signal, progress);
    signal.throwIfAborted();
    await rename(partial, destination);
    return destination;
  } finally {
    await rm(partial, { force: true });
  }
}
