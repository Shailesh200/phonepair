import { contextBridge, ipcRenderer } from 'electron'

export type HelperState = {
  code: string
  status: 'waiting' | 'connected'
  needsAccessibility: boolean
  accessibilityMessage: string
}

contextBridge.exposeInMainWorld('helper', {
  state: (): Promise<HelperState> => ipcRenderer.invoke('state'),
  stop: (): Promise<HelperState> => ipcRenderer.invoke('stop'),
  quit: (): Promise<void> => ipcRenderer.invoke('quit'),
  openAccessibility: (): Promise<void> => ipcRenderer.invoke('open-accessibility'),
  onState: (cb: (state: HelperState) => void) => {
    const listener = (_event: unknown, state: HelperState) => cb(state)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },
})
