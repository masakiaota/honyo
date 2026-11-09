import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./model.ts', () => ({
  LOCAL_MODEL: {
    file: 'model',
    bytes: 4,
    assets: [
      {
        file: 'weights.safetensors',
        bytes: 4,
        sha256: createHash('sha256').update('MLX!').digest('hex'),
        url: 'https://example.test/model',
      },
    ],
  },
}));
import { downloadModel, verifyModel } from './download.ts';
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'honyo-download-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
it('promotes a verified model atomically and does not download it twice', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('MLX!'));
  vi.stubGlobal('fetch', fetch);
  const path = await downloadModel(directory, new AbortController().signal, vi.fn());
  expect(await readFile(join(path, 'weights.safetensors'), 'utf8')).toBe('MLX!');
  expect(await verifyModel(path)).toBe(true);
  await downloadModel(directory, new AbortController().signal, vi.fn());
  expect(fetch).toHaveBeenCalledOnce();
  expect(await readdir(directory)).toEqual(['model']);
});
it.each(['BAD!', 'GG', 'MLX!extra'])(
  'rejects corrupted, truncated or oversized bytes: %s',
  async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(data)));
    await expect(downloadModel(directory, new AbortController().signal, vi.fn())).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  },
);
it('removes partial files when the network fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(downloadModel(directory, new AbortController().signal, vi.fn())).rejects.toThrow(
    'offline',
  );
  expect(await readdir(directory)).toEqual([]);
});
it('does not commit when cancellation occurs during download', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('MLX!')));
  await expect(
    downloadModel(directory, controller.signal, () => controller.abort()),
  ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});

it('uses the chosen directory and checksum without replacing another model', async () => {
  const firstModel = {
    name: 'small',
    file: 'small',
    bytes: 4,
    memory: '',
    sourceUrl: '',
    licenseUrl: '',
    assets: [
      {
        file: 'weights.safetensors',
        bytes: 4,
        sha256: createHash('sha256').update('MLX!').digest('hex'),
        url: 'https://example.test/small',
      },
    ],
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('MLX!')));
  const first = await downloadModel(directory, new AbortController().signal, vi.fn(), firstModel);
  const secondModel = {
    ...firstModel,
    file: 'large',
    bytes: 8,
    assets: [
      {
        file: 'weights.safetensors',
        bytes: 8,
        sha256: createHash('sha256').update('MLX!big!').digest('hex'),
        url: 'https://example.test/large',
      },
    ],
  };
  const fetch = vi.fn().mockResolvedValue(new Response('MLX!big!'));
  vi.stubGlobal('fetch', fetch);
  const second = await downloadModel(directory, new AbortController().signal, vi.fn(), secondModel);
  expect(fetch).toHaveBeenCalledWith(secondModel.assets[0]?.url, expect.anything());
  expect(await verifyModel(second, undefined, secondModel)).toBe(true);
  expect(await verifyModel(first, undefined, secondModel)).toBe(false);
  expect(await readFile(join(first, 'weights.safetensors'), 'utf8')).toBe('MLX!');
  expect((await readdir(directory)).sort()).toEqual(['large', 'small']);
});
