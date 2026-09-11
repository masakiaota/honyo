import type { ReadableStream } from 'node:stream/web';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LOCAL_MODEL, type LocalModel } from './model.ts';

export async function verifyModel(
  path: string,
  signal?: AbortSignal,
  model: LocalModel = LOCAL_MODEL,
): Promise<boolean> {
  try {
    if ((await stat(path)).size !== model.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
      signal?.throwIfAborted();
      hash.update(chunk as Buffer);
    }
    return hash.digest('hex') === model.sha256;
  } catch (error) {
    signal?.throwIfAborted();
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Only verified files are promoted to the final name; interrupted downloads are discarded. */
export async function downloadModel(
  directory: string,
  signal: AbortSignal,
  progress: (bytes: number, verifying: boolean) => void,
  model: LocalModel = LOCAL_MODEL,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const destination = join(directory, model.file);
  if (await verifyModel(destination, signal, model)) return destination;
  const space = await statfs(directory);
  if (space.bavail * space.bsize < model.bytes + 256 * 1024 * 1024)
    throw new Error(
      `Not enough disk space. Free at least ${((model.bytes + 256 * 1024 * 1024) / 1e9).toFixed(1)} GB and try again.`,
    );
  const partial = destination + '.partial';
  let bytes = 0;
  const hash = createHash('sha256');
  try {
    const response = await fetch(model.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]),
    });
    if (!response.ok || !response.body)
      throw new Error(`Model download failed (HTTP ${response.status}). Please try again.`);
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
      { signal },
    );
    progress(bytes, true);
    if (bytes !== model.bytes || hash.digest('hex') !== model.sha256)
      throw new Error('Model verification failed. Please download it again.');
    signal.throwIfAborted();
    await rename(partial, destination);
    return destination;
  } finally {
    await rm(partial, { force: true });
  }
}
