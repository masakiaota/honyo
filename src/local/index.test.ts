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
    verify: vi.fn().mockResolvedValue(true),
    deleted: vi.fn(),
    pending: undefined as Promise<void> | undefined,
  };
});
vi.mock('electron', () => ({ app: { getPath: (): string => '/test-data' } }));
vi.mock('node:fs', () => ({
  existsSync: (): boolean => true,
  statSync: (path: string): { size: number } => ({
    size: path.includes('7B') ? 4624648896 : 1133080448,
  }),
}));
vi.mock('node:fs/promises', () => ({ rm: fake.deleted }));
vi.mock('./download.ts', () => ({ verifyModel: fake.verify, downloadModel: vi.fn() }));
vi.mock('./engine.ts', () => ({
  LocalEngine: class {
    constructor(private path: string) {}
    warmup(): Promise<void> {
      fake.events.push('load:' + this.path);
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
import { LOCAL_MODEL_ID, LOCAL_7B_MODEL_ID, getLocalModel } from './model.ts';
Object.defineProperties(process, fake.descriptors);

it('releases the old model before loading another, verifies each and only deletes the requested file', async () => {
  await warmLocal(LOCAL_MODEL_ID);
  const pending = Promise.withResolvers<void>();
  fake.pending = pending.promise;
  const switching = warmLocal(LOCAL_7B_MODEL_ID);
  await vi.waitFor(() => expect(fake.events).toHaveLength(2));
  expect(fake.events[1]).toContain('release:');
  expect(localState(LOCAL_7B_MODEL_ID).busy).toBe(true);
  await expect(deleteLocal(LOCAL_MODEL_ID)).rejects.toThrow('busy');
  pending.resolve();
  await switching;
  expect(fake.events[2]).toContain('load:/test-data/models/Hy-MT2-7B-');
  expect(fake.verify).toHaveBeenLastCalledWith(
    expect.stringContaining('7B'),
    undefined,
    getLocalModel(LOCAL_7B_MODEL_ID),
  );
  expect(localState(LOCAL_MODEL_ID).total).toBe(1133080448);
  expect(localState(LOCAL_7B_MODEL_ID).total).toBe(4624648896);
  const before = fake.events.length;
  await deleteLocal(LOCAL_MODEL_ID);
  expect(fake.events).toHaveLength(before);
  expect(fake.deleted).toHaveBeenCalledWith('/test-data/models/Hy-MT2-1.8B-Q4_K_M.gguf', {
    force: true,
  });
  await deleteLocal(LOCAL_7B_MODEL_ID);
  expect(fake.events.at(-1)).toContain('release:/test-data/models/Hy-MT2-7B-');
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
