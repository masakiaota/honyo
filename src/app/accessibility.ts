import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { openSettingsWindow } from '../ui/settings.ts';

let window: BrowserWindow | null = null;
let complete: (() => void) | undefined;
let installed = false;

export function hasAccessibilityPermission(): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false);
}

export function openSetupWindow(): void {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return;
  }
  if (!installed) {
    ipcMain.handle('setup-action', async (event, action: string) => {
      if (event.sender !== window?.webContents) return;
      switch (action) {
        case 'status':
          return {
            granted: hasAccessibilityPermission(),
            appName: app.isPackaged ? 'Honyo' : 'Electron',
          };
        case 'permission':
          if (process.platform === 'darwin') {
            systemPreferences.isTrustedAccessibilityClient(true);
            await shell.openExternal(
              'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
            );
          }
          return;
        case 'reveal':
          shell.showItemInFolder(
            app.isPackaged ? join(app.getPath('exe'), '../../..') : app.getPath('exe'),
          );
          return;
        case 'settings':
          openSettingsWindow();
          return;
        case 'restart':
          app.relaunch();
          app.quit();
          return;
        case 'finish':
          if (!hasAccessibilityPermission()) return false;
          complete?.();
          complete = undefined;
          window?.close();
          return true;
        default:
          throw new Error('Unknown setup action');
      }
    });
    installed = true;
  }
  window = new BrowserWindow({
    width: 620,
    height: 760,
    minWidth: 480,
    minHeight: 560,
    title: 'Honyoの準備',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: join(app.getAppPath(), 'build/ui/setup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  void window.loadFile(join(app.getAppPath(), 'setup.html'));
  window.on('closed', () => {
    window = null;
  });
}

export async function checkAccessibilityPermission(): Promise<boolean> {
  if (hasAccessibilityPermission()) return true;
  await new Promise<void>(resolve => {
    complete = resolve;
    openSetupWindow();
  });
  return true;
}
