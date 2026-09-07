import { contextBridge, ipcRenderer } from 'electron';

const actions = new Set(['status', 'permission', 'reveal', 'settings', 'restart', 'finish']);
contextBridge.exposeInMainWorld('setup', {
  action: (action: string): Promise<unknown> => {
    if (!actions.has(action)) return Promise.reject(new Error('Unknown setup action'));
    return ipcRenderer.invoke('setup-action', action);
  },
});
