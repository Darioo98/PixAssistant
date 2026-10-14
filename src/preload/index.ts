import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type DockApi, type UiState } from '@shared/ipc'
import type { DeadlineItem } from '@shared/deadlines'
import type { VaultEntryView } from '@shared/vault'
import type { ChatState, ChatStreamEvent, ConversationItem } from '@shared/chat'

/** Iscrizione a un evento dal processo main; restituisce la funzione per disiscriversi. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

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
  previewMascot: (preview) => ipcRenderer.send(IPC.previewMascot, preview),
  clearIntent: () => ipcRenderer.send(IPC.clearIntent),
  chat: {
    list: () => ipcRenderer.invoke(IPC.chatList),
    onChange: (cb) => subscribe(IPC.chatChanged, (items: ConversationItem[]) => cb(items)),
    state: () => ipcRenderer.invoke(IPC.chatState),
    onState: (cb) => subscribe(IPC.chatStateChanged, (s: ChatState) => cb(s)),
    onStream: (cb) => subscribe(IPC.chatStream, (ev: ChatStreamEvent) => cb(ev)),
    apply: (op) => ipcRenderer.invoke(IPC.chatApply, op)
  },
  vault: {
    list: () => ipcRenderer.invoke(IPC.vaultList),
    onChange: (cb) => {
      const listener = (_e: IpcRendererEvent, items: VaultEntryView[]) => cb(items)
      ipcRenderer.on(IPC.vaultChanged, listener)
      return () => ipcRenderer.removeListener(IPC.vaultChanged, listener)
    },
    apply: (op) => ipcRenderer.invoke(IPC.vaultApply, op)
  },
  deadlines: {
    list: () => ipcRenderer.invoke(IPC.deadlinesList),
    onChange: (cb) => {
      const listener = (_e: IpcRendererEvent, items: DeadlineItem[]) => cb(items)
      ipcRenderer.on(IPC.deadlinesChanged, listener)
      return () => ipcRenderer.removeListener(IPC.deadlinesChanged, listener)
    },
    apply: (op) => ipcRenderer.invoke(IPC.deadlinesApply, op)
  }
}

contextBridge.exposeInMainWorld('dock', api)
