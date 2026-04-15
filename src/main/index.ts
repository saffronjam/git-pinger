import { app, nativeTheme, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ConfigManager } from './config-manager'
import { TokenStore } from './token-store'
import { Poller } from './poller'
import { RepoSyncer } from './repo-syncer'
import { registerIpcHandlers } from './ipc-handlers'

/** Creates the main application window sized to 80% of the primary display. */
function createWindow(): BrowserWindow {
  const isDark = nativeTheme.shouldUseDarkColors
  const bg = isDark ? '#0a0a0a' : '#ffffff'
  const mainWindow = new BrowserWindow({
    width: 860,
    height: 580,
    minWidth: 860,
    minHeight: 580,
    show: false,
    autoHideMenuBar: true,
    title: '',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: bg,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.setName('GitPinger')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.saffronjam.git-pinger')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const configManager = new ConfigManager()
  const tokenStore = new TokenStore()
  const poller = new Poller(configManager, tokenStore)
  const repoSyncer = new RepoSyncer(configManager, tokenStore)

  const mainWindow = createWindow()

  configManager.setMainWindow(mainWindow)
  poller.setMainWindow(mainWindow)
  repoSyncer.setMainWindow(mainWindow)

  registerIpcHandlers(configManager, tokenStore, poller, repoSyncer, mainWindow)

  const config = configManager.get()
  const hasConnections = config.connections.github !== null || config.connections.gitlab !== null
  if (hasConnections) {
    repoSyncer.start()
    if (config.monitoredProjects.length > 0) {
      poller.start()
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
