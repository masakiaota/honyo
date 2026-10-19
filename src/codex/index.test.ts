import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  aiModel: 'claude-5-sonnet',
  configListeners: new Set<() => void>(),
  startCount: 0,
  stopCount: 0,
}));

vi.mock('../config/index.ts', () => ({
  getConfig: (): { aiModel: string } => ({ aiModel: mock.aiModel }),
  subscribeConfig: (listener: () => void): (() => void) => {
    mock.configListeners.add(listener);
    return () => mock.configListeners.delete(listener);
  },
}));

vi.mock('../models-remote.ts', () => ({ setCodexModels: vi.fn() }));

vi.mock('./app-server.ts', () => ({
  CodexAppServer: class {
    start(): Promise<void> {
      mock.startCount++;
      return Promise.resolve();
    }
    stop(): void {
      mock.stopCount++;
    }
    subscribe(): () => void {
      return () => undefined;
    }
    onExit(): () => void {
      return () => undefined;
    }
    readAccount(): Promise<{ type: string }> {
      return Promise.resolve({ type: 'chatgpt' });
    }
    listModels(): Promise<never[]> {
      return Promise.resolve([]);
    }
  },
}));

import { watchCodexRuntime } from './index.ts';

const emitConfigChange = (): void => {
  for (const listener of mock.configListeners) listener();
};
const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
};

beforeEach(() => {
  mock.aiModel = 'claude-5-sonnet';
  mock.configListeners.clear();
  mock.startCount = 0;
  mock.stopCount = 0;
});

describe('Codex runtime watcher', () => {
  it('starts the server when a committed change selects a Codex model', async () => {
    watchCodexRuntime();

    mock.aiModel = 'codex:gpt-5.6-sol';
    emitConfigChange();
    await flush();

    expect(mock.startCount).toBe(1);
    expect(mock.stopCount).toBe(0);
  });

  it('stops the server when the committed selection leaves Codex', async () => {
    mock.aiModel = 'codex:gpt-5.6-sol';
    watchCodexRuntime();

    mock.aiModel = 'claude-5-sonnet';
    emitConfigChange();
    await flush();

    expect(mock.stopCount).toBe(1);
  });

  it('ignores config changes that keep the same model', async () => {
    watchCodexRuntime();

    emitConfigChange();
    await flush();

    expect(mock.startCount).toBe(0);
    expect(mock.stopCount).toBe(0);
  });
});
