import { shutdownChatGPT } from '../chatgpt/index.ts';
import { shutdownLocal } from '../local/index.ts';
import { app } from 'electron';
import { stopKeyboardListener } from '../keyboard/index.ts';
import { destroyTray } from '../ui/tray.ts';
import { openSetupWindow } from './accessibility.ts';

// Prevent multiple instances
export function setupSingleInstance(): boolean {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    console.log('Another instance is already running. Exiting...');
    return false;
  }

  // Handle second instance attempt
  app.on('second-instance', () => {
    console.log('Another instance tried to run');
    void app.whenReady().then(openSetupWindow);
  });

  app.on('activate', () => {
    void app.whenReady().then(openSetupWindow);
  });

  return true;
}

// Keep macOS in menu bar application mode.
export function setupPlatformSpecific(): void {
  if (process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  }
}

// Cleanup function
export function cleanupAndExit(): void {
  stopKeyboardListener();
  shutdownLocal();
  shutdownChatGPT();
  destroyTray();

  // Wait a bit then force exit
  setTimeout(() => {
    app.exit(0);
  }, 100);
}

// Setup shutdown handlers
export function setupShutdownHandlers(): void {
  // Electron app shutdown handling
  app.on('window-all-closed', () => {
    // Don't quit the app when all windows are closed
    // The app should keep running in the system tray
  });

  // Cleanup before app quit
  app.on('before-quit', () => {
    console.log('App is about to quit, cleaning up...');
    stopKeyboardListener();
    shutdownLocal();
    shutdownChatGPT();
  });

  // Process termination handling
  process.on('SIGINT', () => {
    console.log('Received SIGINT, cleaning up...');
    cleanupAndExit();
  });

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, cleaning up...');
    cleanupAndExit();
  });

  process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
    cleanupAndExit();
  });
}
