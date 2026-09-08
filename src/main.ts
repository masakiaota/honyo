import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openSettingsWindow } from './ui/settings.ts';
import { LOCAL_MODEL_ID } from './local/model.ts';
import { warmLocal } from './local/index.ts';
import { app } from 'electron';
import { initializeConfig, getConfig } from './config/index.ts';
import { loadModelsCache, refreshModels, setSelectedModelProvider } from './models-remote.ts';
import { createTray, setupSettingsIPC } from './ui/index.ts';
import { setupKeyboardHandler, startKeyboardListener } from './keyboard/index.ts';
import {
  setupSingleInstance,
  setupPlatformSpecific,
  setupShutdownHandlers,
  checkAccessibilityPermission,
} from './app/index.ts';
import { setupPopupIPC } from './ui/popup.ts';
import { setupAutoUpdater } from './app/updater.ts';
import { initializeCodex } from './codex/index.ts';

// Initialize the app
function initialize(): void {
  // Check for single instance
  if (!setupSingleInstance()) {
    app.quit();
    return;
  }

  // Platform specific setup
  setupPlatformSpecific();

  // Setup shutdown handlers
  setupShutdownHandlers();

  // When app is ready
  void app.whenReady().then(async () => {
    console.log('App ready, starting key listener...');
    console.log('API Key present:', !!process.env.ANTHROPIC_API_KEY);

    // Initialize configuration
    const firstLaunch = !existsSync(join(app.getPath('userData'), 'config.json'));
    initializeConfig();
    if (getConfig().aiModel === LOCAL_MODEL_ID) void warmLocal();

    // Pin the currently-selected model so the model-list cap never drops it
    setSelectedModelProvider(() => getConfig().aiModel);

    // Load cached model list (synchronous) before building the tray menu
    loadModelsCache();

    // Start and initialize the App Server before the shortcut listener is
    // enabled. This keeps the Cmd+C Cmd+C path free of process startup work.
    await initializeCodex();

    // Setup auto-updater
    setupAutoUpdater();

    // Create tray icon
    createTray();

    // Refresh the model list in the background; rebuilds the tray menu on change
    void refreshModels();

    // Setup IPC for settings window
    setupSettingsIPC();
    if (firstLaunch) openSettingsWindow('offline');

    // Setup IPC for popup window
    setupPopupIPC();

    // Keep the tray and settings available while permission is being granted.
    await checkAccessibilityPermission();

    // Setup keyboard handler
    setupKeyboardHandler();

    // Start listening for keyboard events
    try {
      startKeyboardListener();
    } catch (error) {
      console.error('Failed to start keyboard listener:', error);
      app.quit();
    }
  });
}

// Start the application
initialize();
