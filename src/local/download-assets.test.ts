import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadModel, verifyModel } from './download.ts';
import type { LocalModel } from './model.ts';

const contents = ['weights', '{"model_type":"hunyuan_v1_dense"}', 'tokenizer', 'license'];
const files = ['model.safetensors', 'config.json', 'tokenizer.json', 'LICENSE.txt'];
const assets = files.map((file, index) => {
  const data = contents[index] ?? '';
  return {
    file,
    bytes: Buffer.byteLength(data),
    sha256: createHash('sha256').update(data).digest('hex'),
    url: `https://example.test/pinned/${file}`,
  };
});
const model: LocalModel = {
  name: 'MLX test',
  file: 'mlx-pinned',
  bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  sha256: assets[0]?.sha256 ?? '',
  url: assets[0]?.url ?? '',
  memory: 'test',
  template: 'hy7',
  engine: 'mlx',
  assets,
};
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'honyo-assets-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
function network(): ReturnType<typeof vi.fn> {
  const fetch = vi.fn((url: string): Promise<Response> => {
    const index = assets.findIndex(asset => asset.url === url);
    return Promise.resolve(new Response(contents[index]));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
it('installs all pinned assets as one model and verifies every sidecar before reuse', async () => {
  const fetch = network();
  const progress = vi.fn();
  const path = await downloadModel(directory, new AbortController().signal, progress, model);
  expect((await readdir(path)).sort()).toEqual([...files].sort());
  expect(await verifyModel(path, undefined, model)).toBe(true);
  expect(progress).toHaveBeenLastCalledWith(model.bytes, true);
  await downloadModel(directory, new AbortController().signal, progress, model);
  expect(fetch).toHaveBeenCalledTimes(assets.length);
  await writeFile(join(path, 'tokenizer.json'), 'bad-token');
  expect(await verifyModel(path, undefined, model)).toBe(false);
  await downloadModel(directory, new AbortController().signal, progress, model);
  expect(await verifyModel(path, undefined, model)).toBe(true);
  expect(await readdir(directory)).toEqual([model.file]);
});
it('does not expose incomplete models or remove another installed model on sidecar failure', async () => {
  await writeFile(join(directory, 'existing.gguf'), 'existing');
  const fetch = network();
  fetch.mockResolvedValueOnce(new Response(contents[0]));
  fetch.mockResolvedValueOnce(new Response('corrupt'));
  await expect(
    downloadModel(directory, new AbortController().signal, vi.fn(), model),
  ).rejects.toThrow('verification');
  expect(await readdir(directory)).toEqual(['existing.gguf']);
  expect(await readFile(join(directory, 'existing.gguf'), 'utf8')).toBe('existing');
});
it('keeps an invalid previous directory intact until its replacement is complete', async () => {
  const path = join(directory, model.file);
  await mkdir(path);
  await writeFile(join(path, 'config.json'), 'old');
  network().mockRejectedValueOnce(new Error('offline'));
  await expect(
    downloadModel(directory, new AbortController().signal, vi.fn(), model),
  ).rejects.toThrow('offline');
  expect(await readFile(join(path, 'config.json'), 'utf8')).toBe('old');
  expect(await readdir(directory)).toEqual([model.file]);
});
it('does not promote a cancelled final asset and removes the entire staging directory', async () => {
  network();
  const controller = new AbortController();
  await expect(
    downloadModel(
      directory,
      controller.signal,
      (bytes, verifying) => {
        if (bytes === model.bytes && verifying) controller.abort();
      },
      model,
    ),
  ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});
it.each(['../outside', '.', '..', '/absolute'])(
  'rejects unsafe asset path %s before fetching',
  async file => {
    const fetch = network();
    const first = assets[0];
    if (!first) throw new Error('Missing fixture');
    const unsafe = { ...model, assets: [{ ...first, file }], bytes: first.bytes };
    await expect(
      downloadModel(directory, new AbortController().signal, vi.fn(), unsafe),
    ).rejects.toThrow('manifest');
    expect(fetch).not.toHaveBeenCalled();
    expect(await readdir(directory)).toEqual([]);
  },
);
it('honors cancellation during verification of already installed assets', async () => {
  network();
  const path = await downloadModel(directory, new AbortController().signal, vi.fn(), model);
  await expect(verifyModel(path, AbortSignal.abort(), model)).rejects.toThrow();
});
