import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type DockApi, type UiState } from '@shared/ipc'

/** API minima esposta al renderer: nessun accesso diretto a Node o a ipcRenderer. */
const api: DockApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, state: UiState) => cb(state)
    ipcRenderer.on(IPC.state, listener)
    return () => ipcRenderer.removeListener(IPC.state, listener)
  },
  setInteractive: (interactive) => ipcRenderer.send(IPC.setInteractive, Boolean(interactive)),
  openPanel: (tab) => ipcRenderer.send(IPC.openPanel, tab),
  closePanel: () => ipcRenderer.send(IPC.closePanel),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  openDataDir: () => ipcRenderer.send(IPC.openDataDir),
  bubbleOutcome: (bubbleId, outcome) => ipcRenderer.send(IPC.bubbleOutcome, bubbleId, outcome),
  previewMascot: (preview) => ipcRenderer.send(IPC.previewMascot, preview)
}

contextBridge.exposeInMainWorld('dock', api)
