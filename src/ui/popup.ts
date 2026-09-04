import { BrowserWindow, screen, ipcMain, clipboard, Menu, app, type IpcMainEvent } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { cancelCurrentTranslation } from '../keyboard/handler.ts';
import { getConfig, updateConfig } from '../config/index.ts';
import { translateTextDetailed } from '../translation/index.ts';
import { PopupTimer } from './popup-timer.ts';

const DEFAULT_POPUP_WIDTH = 400;
const DEFAULT_POPUP_HEIGHT = 200;
const MIN_POPUP_WIDTH = 280;
const MIN_POPUP_HEIGHT = 160;

// Get __dirname in both ESM and CommonJS
const getCurrentDir = (): string => {
  if (typeof import.meta.url !== 'undefined') {
    // ESM
    return dirname(fileURLToPath(import.meta.url));
  } else {
    // CommonJS
    return __dirname;
  }
};

const currentDir = getCurrentDir();

let popupWindow: BrowserWindow | null = null;
let previousActiveApp: string | null = null;
let restorePreviousAppOnClose = true;
// Language pair of the current translation. Kept here because it can be
// resolved while a freshly-created popup window is still loading — IPC sent
// before did-finish-load is dropped, so it is re-sent once the page is ready.
let pendingLanguages: { sourceLanguage: string; targetLanguage: string } | null = null;

const popupTimer = new PopupTimer(
  (remainingSeconds, urgency) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      popupWindow.webContents.send('popup-time-remaining', { remainingSeconds, urgency });
    }
  },
  () => closePopup(false),
);

function getPreloadPath(): string {
  return app.isPackaged
    ? join(currentDir, 'popup-preload.js')
    : join(currentDir, '../../build/ui/popup-preload.js');
}

function isPopupEvent(event: IpcMainEvent): boolean {
  return event.sender === popupWindow?.webContents;
}

// Send the current popup display config (read fresh so settings changes apply to
// the next popup without a restart).
function sendPopupConfig(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const config = getConfig();
  popupWindow.webContents.send('popup-config', {
    fontSize: config.popupFontSize ?? 14,
    autoCloseAfterFiveMinutes: config.autoCloseAfterFiveMinutes ?? true,
  });
}

function resetPopupTimer(): void {
  popupTimer.stop();
  if (
    popupWindow &&
    !popupWindow.isDestroyed() &&
    (getConfig().autoCloseAfterFiveMinutes ?? true)
  ) {
    popupTimer.start();
  }
}

// Resolve the initial popup size from config (persisted size, or the default),
// clamped to the minimum and the display work area.
function getInitialPopupSize(cursorPoint: { x: number; y: number }): {
  width: number;
  height: number;
} {
  const { popupSize } = getConfig();
  let width = popupSize?.width ?? DEFAULT_POPUP_WIDTH;
  let height = popupSize?.height ?? DEFAULT_POPUP_HEIGHT;

  const workArea = screen.getDisplayNearestPoint(cursorPoint).workAreaSize;
  width = Math.max(MIN_POPUP_WIDTH, Math.min(width, workArea.width));
  height = Math.max(MIN_POPUP_HEIGHT, Math.min(height, workArea.height));

  return { width, height };
}

// Persist the current popup size (fired once per manual resize via 'resized').
function savePopupSize(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  const [width = DEFAULT_POPUP_WIDTH, height = DEFAULT_POPUP_HEIGHT] = popupWindow.getSize();
  updateConfig({ popupSize: { width, height } });
}

// Reset an open popup window to the default size (used by the settings reset).
export function resetPopupSize(): void {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.setSize(DEFAULT_POPUP_WIDTH, DEFAULT_POPUP_HEIGHT);
  }
}

// Function to get the currently active application
function capturePreviousApp(): void {
  if (process.platform === 'darwin') {
    exec(
      'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\'',
      (error, stdout) => {
        if (!error && stdout) {
          previousActiveApp = stdout.trim();
          console.log('Captured previous app:', previousActiveApp);
        }
      },
    );
  }
}

// Function to restore focus to the previous application
function restorePreviousApp(): void {
  const appToRestore = previousActiveApp;
  previousActiveApp = null;
  if (process.platform === 'darwin' && appToRestore && appToRestore !== 'Electron') {
    exec(`osascript -e 'tell application "${appToRestore}" to activate'`, error => {
      if (error) {
        console.error('Failed to restore previous app:', error);
      } else {
        console.log('Restored focus to:', appToRestore);
      }
    });
  }
}

export function showTranslationPopup(translation: string | null, originalText: string): void {
  // A new translation cycle starts: its language pair is not known yet.
  pendingLanguages = null;

  // Get cursor position with DPI scaling consideration
  const cursorPoint = screen.getCursorScreenPoint();

  // Capture the previously active app before showing the popup
  if (!popupWindow || popupWindow.isDestroyed()) {
    capturePreviousApp();
  }

  // If popup exists, update content without repositioning
  if (popupWindow && !popupWindow.isDestroyed()) {
    // Apply current font size before updating content
    sendPopupConfig();

    // Update content
    if (translation === null) {
      popupWindow.webContents.send('translation-loading');
    } else {
      popupWindow.webContents.send('translation-data', {
        translation,
        originalText,
      });
    }

    resetPopupTimer();

    // Focus the window
    popupWindow.focus();
    return;
  }

  // Create popup window (using the persisted size when available)
  const initialSize = getInitialPopupSize(cursorPoint);
  popupWindow = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: MIN_POPUP_WIDTH,
    minHeight: MIN_POPUP_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: getPreloadPath(),
    },
  });

  // Ensure window stays on top
  popupWindow.setAlwaysOnTop(true, 'floating');

  // Persist the size after a manual resize (fires once per drag on macOS)
  popupWindow.on('resized', savePopupSize);

  // Position the window
  repositionPopup(cursorPoint);

  // Load popup HTML
  const htmlPath = join(currentDir, '../../popup.html');
  void popupWindow.loadFile(htmlPath);

  popupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popupWindow.webContents.on('will-navigate', event => event.preventDefault());

  // Send initial state once loaded
  popupWindow.webContents.once('did-finish-load', () => {
    sendPopupConfig();
    popupTimer.publish();
    if (translation === null) {
      popupWindow?.webContents.send('translation-loading');
    } else {
      popupWindow?.webContents.send('translation-data', {
        translation,
        originalText,
      });
    }
    // Re-deliver the language pair if it resolved while the page was loading
    // (IPC sent before did-finish-load is dropped).
    if (pendingLanguages) {
      popupWindow?.webContents.send('translation-langs', pendingLanguages);
    }
  });

  resetPopupTimer();

  // Add blur event handler based on user preference
  const config = getConfig();
  if (config.autoCloseOnBlur) {
    popupWindow.on('blur', () => {
      closePopup();
    });
  }

  popupWindow.on('closed', () => {
    popupTimer.stop();
    if (restorePreviousAppOnClose) {
      restorePreviousApp();
    } else {
      previousActiveApp = null;
    }
    restorePreviousAppOnClose = true;
    popupWindow = null;
  });
}

export function updatePopupTranslation(text: string): void {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('translation-chunk', text);
  }
}

export function updatePopupLanguages(sourceLanguage: string, targetLanguage: string): void {
  pendingLanguages = { sourceLanguage, targetLanguage };
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('translation-langs', pendingLanguages);
  }
}

export function finalizePopupTranslation(text: string): void {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.webContents.send('translation-complete', text);
  }
}

async function writeClipboardText(text: string): Promise<void> {
  try {
    await clipboard.writeText(text);
  } catch (error) {
    console.error('Failed to copy translation:', error);
  }
}

export function setupPopupIPC(): void {
  ipcMain.on('copy-translation', (event, text: string) => {
    if (!isPopupEvent(event)) return;
    void (async (): Promise<void> => {
      try {
        await writeClipboardText(text);
      } finally {
        closePopup();
      }
    })();
  });

  ipcMain.on('close-popup', event => {
    if (!isPopupEvent(event)) return;
    // Cancel any ongoing translation when closing popup
    cancelCurrentTranslation();
    closePopup();
  });

  ipcMain.on('extend-popup-timeout', event => {
    if (!isPopupEvent(event)) return;
    resetPopupTimer();
  });

  ipcMain.on('back-translate', (event, text: string) => {
    if (!isPopupEvent(event)) return;
    void (async (): Promise<void> => {
      if (!popupWindow || popupWindow.isDestroyed() || !text) return;
      try {
        const config = getConfig();
        // The language-detection rules translate the translation back to the
        // source language automatically.
        const result = await translateTextDetailed(
          text,
          config.targetLanguage,
          config.secondaryLanguage,
        );
        if (!popupWindow || popupWindow.isDestroyed()) return;
        popupWindow.webContents.send('back-translation-result', {
          translation: result.translation,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
        });
      } catch (error) {
        if (popupWindow && !popupWindow.isDestroyed()) {
          popupWindow.webContents.send(
            'back-translation-error',
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    })();
  });

  ipcMain.on(
    'show-context-menu',
    (event, data: { selectedText: string; hasSelection: boolean }) => {
      if (!isPopupEvent(event)) return;
      if (!popupWindow || popupWindow.isDestroyed()) return;

      const template = [];

      if (data.hasSelection) {
        template.push(
          {
            label: 'Copy',
            click: () => {
              void writeClipboardText(data.selectedText);
            },
          },
          { type: 'separator' as const },
        );
      }

      template.push({
        label: 'Copy All',
        click: () => {
          popupWindow?.webContents.send('copy-all-requested');
        },
      });

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: popupWindow });
    },
  );
}

export function closePopup(restoreFocus = true): void {
  popupTimer.stop();
  if (popupWindow && !popupWindow.isDestroyed()) {
    restorePreviousAppOnClose = restoreFocus;
    popupWindow.close();
  }
}

function repositionPopup(cursorPoint: { x: number; y: number }): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;

  const [width = DEFAULT_POPUP_WIDTH, height = DEFAULT_POPUP_HEIGHT] = popupWindow.getSize();
  const windowBounds = { width, height };

  // Get all displays to handle multi-monitor setups
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const displayBounds = currentDisplay.bounds;

  // Calculate position (center window on cursor)
  let x = cursorPoint.x - windowBounds.width / 2;
  let y = cursorPoint.y - windowBounds.height / 2;

  // Ensure popup doesn't go off-screen
  if (x + windowBounds.width > displayBounds.x + displayBounds.width) {
    x = displayBounds.x + displayBounds.width - windowBounds.width - 10;
  }
  if (y + windowBounds.height > displayBounds.y + displayBounds.height) {
    y = displayBounds.y + displayBounds.height - windowBounds.height - 10;
  }
  if (x < displayBounds.x) {
    x = displayBounds.x + 10;
  }
  if (y < displayBounds.y) {
    y = displayBounds.y + 10;
  }

  popupWindow.setPosition(Math.round(x), Math.round(y));
}
