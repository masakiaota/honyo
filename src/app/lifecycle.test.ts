vi.mock('../chatgpt/index.ts', () => ({ shutdownChatGPT: vi.fn() }));
import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  events: new Map<string, () => void>(),
  ready: Promise.resolve(),
  openSetupWindow: vi.fn(),
  setActivationPolicy: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: (): boolean => true,
    on: (event: string, callback: () => void): void => {
      mock.events.set(event, callback);
    },
    whenReady: (): Promise<void> => mock.ready,
    setActivationPolicy: mock.setActivationPolicy,
  },
}));
vi.mock('../keyboard/index.ts', () => ({ stopKeyboardListener: vi.fn() }));
vi.mock('../ui/tray.ts', () => ({ destroyTray: vi.fn() }));
vi.mock('./accessibility.ts', () => ({ openSetupWindow: mock.openSetupWindow }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.events.clear();
});
it('configures macOS as a menu bar application', async () => {
  const { setupPlatformSpecific } = await import('./lifecycle.ts');
  setupPlatformSpecific();
  if (process.platform === 'darwin') {
    expect(mock.setActivationPolicy).toHaveBeenCalledExactlyOnceWith('accessory');
  } else {
    expect(mock.setActivationPolicy).not.toHaveBeenCalled();
  }
});
it.each(['second-instance', 'activate'])(
  'waits until ready before opening setup on %s',
  async event => {
    const ready = Promise.withResolvers<void>();
    mock.ready = ready.promise;
    const { setupSingleInstance } = await import('./lifecycle.ts');
    expect(setupSingleInstance()).toBe(true);
    const callback = mock.events.get(event);
    expect(callback).toBeDefined();
    callback?.();
    expect(mock.openSetupWindow).not.toHaveBeenCalled();
    ready.resolve();
    await mock.ready;
    expect(mock.openSetupWindow).toHaveBeenCalledOnce();
  },
);
