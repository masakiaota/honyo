import { contextBridge, ipcRenderer } from 'electron';

const sendChannels = new Set([
  'load-api-keys',
  'save-api-keys',
  'load-custom-prompt',
  'save-custom-prompt',
  'load-custom-model',
  'save-custom-model',
  'load-custom-languages',
  'save-custom-languages',
  'load-auto-close-on-blur',
  'save-auto-close-on-blur',
  'save-display-settings',
  'reset-popup-size',
  'load-open-at-login',
  'save-open-at-login',
  'generate-custom-prompt',
]);

const receiveChannels = new Set([
  'api-keys-loaded',
  'api-keys-saved',
  'custom-prompt-loaded',
  'custom-prompt-saved',
  'custom-model-loaded',
  'custom-model-saved',
  'custom-languages-loaded',
  'custom-languages-saved',
  'auto-close-on-blur-loaded',
  'enable-streaming-loaded',
  'popup-font-size-loaded',
  'auto-close-on-blur-saved',
  'display-settings-saved',
  'popup-size-reset',
  'open-at-login-loaded',
  'open-at-login-saved',
  'custom-prompt-generated',
]);

contextBridge.exposeInMainWorld('honyoSettings', {
  send(channel: string, ...args: unknown[]): void {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },
  on(channel: string, listener: (...args: unknown[]) => void): () => void {
    if (!receiveChannels.has(channel)) {
      return () => undefined;
    }

    const wrappedListener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => {
      listener(undefined, ...args);
    };
    ipcRenderer.on(channel, wrappedListener);
    return () => ipcRenderer.removeListener(channel, wrappedListener);
  },
});
