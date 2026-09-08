import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('./model.ts', () => ({
  LOCAL_MODEL: {
    file: 'model.gguf',
    bytes: 4,
    sha256: createHash('sha256').update('GGUF').digest('hex'),
    url: 'https://example.test/model',
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
  const fetch = vi.fn().mockResolvedValue(new Response('GGUF'));
  vi.stubGlobal('fetch', fetch);
  const path = await downloadModel(directory, new AbortController().signal, vi.fn());
  expect(await readFile(path, 'utf8')).toBe('GGUF');
  expect(await verifyModel(path)).toBe(true);
  await downloadModel(directory, new AbortController().signal, vi.fn());
  expect(fetch).toHaveBeenCalledOnce();
  expect(await readdir(directory)).toEqual(['model.gguf']);
});
it.each(['BAD!', 'GG', 'GGUFextra'])(
  'rejects corrupted, truncated or oversized bytes: %s',
  async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(data)));
    await expect(downloadModel(directory, new AbortController().signal, vi.fn())).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  },
);
it('removes partial files when the network fails', async () => {
  await writeFile(join(directory, 'model.gguf.partial'), 'stale');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(downloadModel(directory, new AbortController().signal, vi.fn())).rejects.toThrow(
    'offline',
  );
  expect(await readdir(directory)).toEqual([]);
});
it('does not commit when cancellation occurs during download', async () => {
  const controller = new AbortController();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('GGUF')));
  await expect(
    downloadModel(directory, controller.signal, () => controller.abort()),
  ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});
