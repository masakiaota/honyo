import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  trusted: false,
  handler: undefined as ((event: unknown, action: string) => Promise<unknown>) | undefined,
  windows: [] as { webContents: object; close: ReturnType<typeof vi.fn> }[],
  openExternal: vi.fn(),
  quit: vi.fn(),
  relaunch: vi.fn(),
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getAppPath: (): string => '/app',
    getPath: (): string => '/Applications/Honyo.app/Contents/MacOS/Honyo',
    quit: mock.quit,
    relaunch: mock.relaunch,
  },
  systemPreferences: { isTrustedAccessibilityClient: (): boolean => mock.trusted },
  shell: { openExternal: mock.openExternal, showItemInFolder: vi.fn() },
  ipcMain: {
    handle: (_: string, handler: typeof mock.handler): void => {
      mock.handler = handler;
    },
  },
  BrowserWindow: class {
    webContents = { setWindowOpenHandler: vi.fn(), on: vi.fn() };
    close = vi.fn();
    loadFile = vi.fn();
    on = vi.fn();
    isMinimized = (): boolean => false;
    show = vi.fn();
    focus = vi.fn();
    constructor() {
      mock.windows.push(this);
    }
  },
}));
vi.mock('../ui/settings.ts', () => ({ openSettingsWindow: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.trusted = false;
  mock.windows = [];
  mock.handler = undefined;
});
it('does not create a wizard when permission is already granted', async () => {
  mock.trusted = true;
  const { checkAccessibilityPermission } = await import('./accessibility.ts');
  expect(await checkAccessibilityPermission()).toBe(true);
  expect(mock.windows).toHaveLength(0);
});
it.skipIf(process.platform !== 'darwin')(
  'waits for explicit completion and rechecks permission without quitting',
  async () => {
    const { checkAccessibilityPermission } = await import('./accessibility.ts');
    const done = vi.fn();
    const pending = checkAccessibilityPermission().then(done);
    const event = { sender: mock.windows[0]?.webContents };
    expect(await invoke(event, 'finish')).toBe(false);
    expect(done).not.toHaveBeenCalled();
    await invoke(event, 'permission');
    expect(mock.openExternal).toHaveBeenCalled();
    expect(mock.quit).not.toHaveBeenCalled();
    mock.trusted = true;
    expect(await invoke(event, 'status')).toEqual({ granted: true, appName: 'Honyo' });
    expect(done).not.toHaveBeenCalled();
    expect(await invoke(event, 'finish')).toBe(true);
    await pending;
    expect(done).toHaveBeenCalledWith(true);
  },
);
it('ignores actions from other windows and reuses the setup window', async () => {
  const { openSetupWindow } = await import('./accessibility.ts');
  openSetupWindow();
  openSetupWindow();
  expect(mock.windows).toHaveLength(1);
  await invoke({ sender: {} }, 'restart');
  expect(mock.relaunch).not.toHaveBeenCalled();
});

async function invoke(event: unknown, action: string): Promise<unknown> {
  if (!mock.handler) throw new Error('Setup handler was not registered');
  return mock.handler(event, action);
}
