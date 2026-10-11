import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { basename } from 'node:path';
const fake = vi.hoisted(() => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  if (!platform || !arch) throw new Error('Missing process platform descriptors');
  const descriptors = { platform, arch };
  Object.defineProperties(process, {
    platform: { value: 'darwin', configurable: true },
    arch: { value: 'arm64', configurable: true },
  });
  return {
    descriptors,
    packaged: false,
    helperPresent: true,
    missing: '',
    verify: vi.fn().mockResolvedValue(true),
    download: vi.fn().mockResolvedValue('model-dir'),
    deleted: vi.fn(),
    warm: vi.fn().mockResolvedValue(undefined),
    translate: vi.fn().mockResolvedValue({ translation: '訳文' }),
    release: vi.fn().mockResolvedValue(undefined),
    construct: vi.fn(),
    gguf: vi.fn(),
  };
});
vi.mock('electron', () => ({
  app: {
    getPath: (): string => '/test-data',
    getAppPath: (): string => '/app',
    get isPackaged(): boolean {
      return fake.packaged;
    },
  },
}));
vi.mock('node:fs', () => ({
  existsSync: (): boolean => fake.helperPresent,
  statSync: (path: string): { size: number } => {
    if (basename(path) === fake.missing) throw new Error('missing');
    const model = getLocalModel(LOCAL_MLX_7B_MODEL_ID);
    return {
      size: model.assets?.find(asset => asset.file === basename(path))?.bytes ?? 4624648896,
    };
  },
}));
vi.mock('node:fs/promises', () => ({ rm: fake.deleted }));
vi.mock('./download.ts', () => ({ verifyModel: fake.verify, downloadModel: fake.download }));
vi.mock('./engine.ts', () => ({
  LocalEngine: class {
    constructor(path: string) {
      fake.gguf(path);
    }
    warmup = fake.warm;
    release = fake.release;
    translate = fake.translate;
  },
}));
vi.mock('./mlx-engine.ts', () => ({
  MlxEngine: class {
    constructor(path: string, helper: string) {
      fake.construct(path, helper);
    }
    warmup = fake.warm;
    release = fake.release;
    translate = fake.translate;
  },
}));
import { LOCAL_MLX_7B_MODEL_ID } from './mlx-model.ts';
import { getLocalModel, LOCAL_7B_MODEL_ID } from './model.ts';
import {
  warmLocal,
  deleteLocal,
  installLocal,
  localState,
  releaseLocal,
  translateLocal,
} from './index.ts';

beforeEach(() => {
  fake.packaged = false;
  fake.helperPresent = true;
  fake.missing = '';
  vi.clearAllMocks();
});
afterEach(async () => {
  releaseLocal();
  await Promise.resolve();
  await Promise.resolve();
});
afterAll(() => Object.defineProperties(process, fake.descriptors));

it('treats a directory as installed only when every asset has the expected size', () => {
  expect(localState(LOCAL_MLX_7B_MODEL_ID).installed).toBe(true);
  fake.missing = 'tokenizer.json';
  expect(localState(LOCAL_MLX_7B_MODEL_ID).installed).toBe(false);
});
it('selects resident MLX explicitly, preserves GGUF selection, and passes the dev helper path', async () => {
  await warmLocal(LOCAL_MLX_7B_MODEL_ID, 'English');
  const path = '/test-data/models/' + getLocalModel(LOCAL_MLX_7B_MODEL_ID).file;
  expect(fake.construct).toHaveBeenCalledWith(path, '/app/build/mlx/honyo-mlx');
  expect(fake.warm).toHaveBeenCalledWith('English');
  await translateLocal('Hello', 'English', 'Japanese', undefined, undefined, LOCAL_MLX_7B_MODEL_ID);
  expect(fake.construct).toHaveBeenCalledOnce();
  await warmLocal(LOCAL_7B_MODEL_ID);
  expect(fake.release).toHaveBeenCalledOnce();
  expect(fake.gguf).toHaveBeenCalledWith('/test-data/models/Hy-MT2-7B-Q4_K_M.gguf');
});
it('uses the asar-external packaged helper and removes only the selected MLX directory', async () => {
  fake.packaged = true;
  vi.stubGlobal('process', Object.assign(Object.create(process), { resourcesPath: '/resources' }));
  try {
    await warmLocal(LOCAL_MLX_7B_MODEL_ID);
    expect(fake.construct).toHaveBeenCalledWith(expect.any(String), '/resources/mlx/honyo-mlx');
    await deleteLocal(LOCAL_MLX_7B_MODEL_ID);
    expect(fake.deleted).toHaveBeenCalledWith(
      '/test-data/models/' + getLocalModel(LOCAL_MLX_7B_MODEL_ID).file,
      { recursive: true, force: true },
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
it('fails before a large download if the app lacks its MLX helper', async () => {
  fake.helperPresent = false;
  await expect(installLocal(LOCAL_MLX_7B_MODEL_ID)).rejects.toThrow('helper is missing');
  expect(fake.download).not.toHaveBeenCalled();
  await warmLocal(LOCAL_MLX_7B_MODEL_ID);
  expect(localState(LOCAL_MLX_7B_MODEL_ID).error).toContain('helper is missing');
});
it('waits for explicit release before loading again instead of holding two resident engines', async () => {
  await warmLocal(LOCAL_MLX_7B_MODEL_ID);
  const barrier = Promise.withResolvers<void>();
  fake.release.mockReturnValueOnce(barrier.promise);
  releaseLocal();
  const warming = warmLocal(LOCAL_7B_MODEL_ID);
  await Promise.resolve();
  expect(fake.gguf).not.toHaveBeenCalled();
  barrier.resolve();
  await warming;
  expect(fake.gguf).toHaveBeenCalledOnce();
});

it('blocks replacement engines when native shutdown cannot be confirmed', async () => {
  await warmLocal(LOCAL_MLX_7B_MODEL_ID);
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    fake.release.mockRejectedValueOnce(new Error('shutdown uncertain'));
    releaseLocal();
    await warmLocal(LOCAL_7B_MODEL_ID);
    expect(fake.gguf).not.toHaveBeenCalled();
    expect(localState(LOCAL_7B_MODEL_ID).error).toBe('shutdown uncertain');
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
