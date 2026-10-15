import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type PixApi, type UiState } from '@shared/ipc'
import type { DeadlineItem } from '@shared/deadlines'
import type { VaultData } from '@shared/vault'
import type { ChatState, ChatStreamEvent, ConversationItem } from '@shared/chat'
import type { ClipState, LinkView } from '@shared/extras'
import type { MaintenanceState } from '@shared/maintenance'
import type { ShiftState } from '@shared/shift'

/** Iscrizione a un evento dal processo main; restituisce la funzione per disiscriversi. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** API minima esposta al renderer: nessun accesso diretto a Node o a ipcRenderer. */
const api: PixApi = {
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
  shift: {
    state: () => ipcRenderer.invoke(IPC.shiftState),
    onChange: (cb) => subscribe(IPC.shiftChanged, (s: ShiftState) => cb(s)),
    apply: (op) => ipcRenderer.invoke(IPC.shiftApply, op)
  },
  maintenance: {
    state: () => ipcRenderer.invoke(IPC.maintState),
    onChange: (cb) => subscribe(IPC.maintChanged, (s: MaintenanceState) => cb(s)),
    apply: (op) => ipcRenderer.invoke(IPC.maintApply, op)
  },
  clipboard: {
    state: () => ipcRenderer.invoke(IPC.clipState),
    onChange: (cb) => subscribe(IPC.clipChanged, (s: ClipState) => cb(s)),
    apply: (op) => ipcRenderer.invoke(IPC.clipApply, op)
  },
  links: {
    list: () => ipcRenderer.invoke(IPC.linksList),
    onChange: (cb) => subscribe(IPC.linksChanged, (items: LinkView[]) => cb(items)),
    apply: (op) => ipcRenderer.invoke(IPC.linksApply, op)
  },
  weather: (force) => ipcRenderer.invoke(IPC.weather, Boolean(force)),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  drop: (payload) => ipcRenderer.invoke(IPC.drop, payload),
  data: {
    list: (collection) => ipcRenderer.invoke(IPC.dataList, collection),
    onChange: (collection, cb) =>
      subscribe(IPC.dataChanged, (p: { collection: string; items: never }) => {
        if (p.collection === collection) cb(p.items)
      }),
    apply: (collection, op) => ipcRenderer.invoke(IPC.dataApply, collection, op)
  },
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
      const listener = (_e: IpcRendererEvent, data: VaultData) => cb(data)
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

contextBridge.exposeInMainWorld('pix', api)
