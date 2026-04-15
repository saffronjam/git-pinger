import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
} else {
  ;(globalThis as Record<string, unknown>).electron = electronAPI
}
