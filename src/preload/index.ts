import { contextBridge, ipcRenderer } from 'electron';
import type { AppEvent, ApiMethod, ApiParams, ApiResults, RendererApi, Result } from '../shared/types';

const api: RendererApi = {
  invoke: <M extends ApiMethod>(method: M, payload: ApiParams[M]): Promise<Result<ApiResults[M]>> =>
    ipcRenderer.invoke('gitpp:invoke', { method, payload }) as Promise<Result<ApiResults[M]>>,
  onEvent: (listener: (event: AppEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppEvent) => listener(payload);
    ipcRenderer.on('gitpp:event', handler);
    return () => ipcRenderer.removeListener('gitpp:event', handler);
  },
  platform: process.platform,
  transport: 'ipc',
};

contextBridge.exposeInMainWorld('gitpp', {
  ...api,
  window: {
    minimize: () => ipcRenderer.invoke('gitpp:window', 'minimize'),
    maximize: () => ipcRenderer.invoke('gitpp:window', 'maximize'),
    close: () => ipcRenderer.invoke('gitpp:window', 'close'),
    isMaximized: () => ipcRenderer.invoke('gitpp:window', 'inspect'),
    onMaximized: (listener: (maximized: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: boolean) => listener(value);
      ipcRenderer.on('gitpp:maximized', handler);
      return () => ipcRenderer.removeListener('gitpp:maximized', handler);
    },
  },
  startup: () => ipcRenderer.invoke('gitpp:startup') as Promise<{ warnings: string[] }>,
  onMenuCommand: (listener: (command: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: string) => listener(command);
    ipcRenderer.on('gitpp:menu', handler);
    return () => ipcRenderer.removeListener('gitpp:menu', handler);
  },
});
