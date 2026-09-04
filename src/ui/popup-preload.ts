import { contextBridge, ipcRenderer } from 'electron';

const sendChannels = new Set([
  'show-context-menu',
  'back-translate',
  'copy-translation',
  'close-popup',
  'extend-popup-timeout',
]);

const receiveChannels = new Set([
  'popup-config',
  'popup-time-remaining',
  'translation-loading',
  'translation-langs',
  'translation-data',
  'translation-chunk',
  'translation-complete',
  'back-translation-result',
  'back-translation-error',
  'copy-all-requested',
]);

contextBridge.exposeInMainWorld('honyoPopup', {
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
