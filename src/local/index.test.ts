import { expect, it, vi } from 'vitest';
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
    events: [] as string[],
    targets: [] as string[],
    verify: vi.fn().mockResolvedValue(true),
    deleted: vi.fn(),
    pending: undefined as Promise<void> | undefined,
  };
});
vi.mock('electron', () => ({
  app: { getPath: (): string => '/test-data', getAppPath: (): string => '/app' },
}));
vi.mock('node:fs', () => ({
  existsSync: (): boolean => true,
  statSync: (path: string): { size: number } => ({
    size:
      Object.values(LOCAL_MODELS)
        .find(model => path.includes('/' + model.file + '/'))
        ?.assets.find(asset => path.endsWith('/' + asset.file))?.bytes ?? 0,
  }),
}));
vi.mock('node:fs/promises', () => ({ rm: fake.deleted }));
vi.mock('./download.ts', () => ({ verifyModel: fake.verify, downloadModel: vi.fn() }));
vi.mock('./mlx-engine.ts', () => ({
  MlxEngine: class {
    constructor(private path: string) {}
    warmup(targetLanguage: string): Promise<void> {
      fake.events.push('load:' + this.path);
      fake.targets.push(targetLanguage);
      return Promise.resolve();
    }
    async release(): Promise<void> {
      fake.events.push('release:' + this.path);
      await fake.pending;
    }
    translate(): Promise<{ translation: string }> {
      fake.events.push('translate:' + this.path);
      return Promise.resolve({ translation: 'test' });
    }
  },
}));
import { warmLocal, deleteLocal, localState, releaseLocal } from './index.ts';
import { LOCAL_MODEL_ID, getLocalModel, LOCAL_MODELS } from './model.ts';
const SECOND_MODEL_ID = 'local-plamo-3-8b';
Object.defineProperties(process, fake.descriptors);

it('releases the old model before loading another, verifies each and only deletes the requested file', async () => {
  await warmLocal(LOCAL_MODEL_ID);
  const pending = Promise.withResolvers<void>();
  fake.pending = pending.promise;
  const switching = warmLocal(SECOND_MODEL_ID, 'English');
  await vi.waitFor(() => expect(fake.events).toHaveLength(2));
  expect(fake.events[1]).toContain('release:');
  expect(localState(SECOND_MODEL_ID).busy).toBe(true);
  await expect(deleteLocal(LOCAL_MODEL_ID)).rejects.toThrow('busy');
  pending.resolve();
  await switching;
  expect(fake.targets).toEqual(['Japanese', 'English']);
  expect(fake.events[2]).toContain('load:/test-data/models/plamo-3-translate-8b-');
  expect(fake.verify).toHaveBeenLastCalledWith(
    expect.stringContaining('8b'),
    undefined,
    getLocalModel(SECOND_MODEL_ID),
  );
  expect(localState(LOCAL_MODEL_ID).total).toBe(getLocalModel(LOCAL_MODEL_ID).bytes);
  expect(localState(SECOND_MODEL_ID).total).toBe(getLocalModel(SECOND_MODEL_ID).bytes);
  const before = fake.events.length;
  await deleteLocal(LOCAL_MODEL_ID);
  expect(fake.events).toHaveLength(before);
  expect(fake.deleted).toHaveBeenCalledWith(
    '/test-data/models/' + getLocalModel(LOCAL_MODEL_ID).file,
    {
      recursive: true,
      force: true,
    },
  );
  await deleteLocal(SECOND_MODEL_ID);
  expect(fake.events.at(-1)).toContain('release:/test-data/models/plamo-3-translate-8b-');
  const verification = Promise.withResolvers<boolean>();
  fake.verify.mockReturnValueOnce(verification.promise);
  const beforeCancel = fake.events.length;
  const warming = warmLocal(LOCAL_MODEL_ID);
  await vi.waitFor(() => expect(fake.verify).toHaveBeenCalledTimes(3));
  releaseLocal();
  verification.resolve(true);
  await warming;
  expect(fake.events).toHaveLength(beforeCancel);
  expect(localState(LOCAL_MODEL_ID).phase).toBe('idle');
  await expect(warmLocal('../unknown')).rejects.toThrow('Unknown offline model');
});
