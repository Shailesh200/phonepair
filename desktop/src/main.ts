import { app, BrowserWindow, ipcMain, shell, systemPreferences } from 'electron'
import path from 'node:path'
import { createNutInjector, releaseModifiers } from 'phonepair-helper/inject'
import { startHelperApp, type HelperApp, type HelperStatus, type Injector } from './session.js'

export const ACCESSIBILITY_MESSAGE = 'Allow PhonePair Helper in System Settings > Privacy & Security > Accessibility'
export const ACCESSIBILITY_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

const here = __dirname

let running: HelperApp | null = null
let inject: Injector | null = null
let win: BrowserWindow | null = null
let cleaned = false

function needsAccessibility(): boolean {
  if (process.platform !== 'darwin') return false
  return !systemPreferences.isTrustedAccessibilityClient(false)
}

function snapshot() {
  return {
    code: running?.code ?? '',
    status: (running?.status() ?? 'waiting') as HelperStatus,
    needsAccessibility: needsAccessibility(),
    accessibilityMessage: ACCESSIBILITY_MESSAGE,
  }
}

function publish(status?: HelperStatus) {
  const state = snapshot()
  if (status) state.status = status
  win?.webContents.send('state', state)
}

async function boot(code?: string) {
  if (!inject) inject = createNutInjector()
  running = await startHelperApp({
    packaged: app.isPackaged,
    inject,
    code,
    onStatus: (status) => publish(status),
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 380,
    height: 520,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'PhonePair Helper',
    backgroundColor: '#f6f7fb',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  void win.loadFile(path.join(here, 'window.html'))
  win.on('closed', () => { win = null })
}

app.setName('PhonePair Helper')

app.whenReady().then(async () => {
  await boot()
  createWindow()

  ipcMain.handle('state', () => snapshot())
  ipcMain.handle('stop', async () => {
    if (!running) return snapshot()
    await running.stop()
    publish('waiting')
    return snapshot()
  })
  ipcMain.handle('quit', () => {
    app.quit()
  })
  ipcMain.handle('open-accessibility', () => shell.openExternal(ACCESSIBILITY_URL))
}).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'Helper failed to start')
  app.quit()
})

app.on('window-all-closed', () => {
  app.quit()
})

process.on('exit', () => { running?.stopMover() })

app.on('before-quit', (event) => {
  if (cleaned) return
  event.preventDefault()
  cleaned = true
  running?.stopMover()
  void (async () => {
    await running?.close()
    await Promise.race([
      releaseModifiers().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ])
    app.quit()
  })()
})
