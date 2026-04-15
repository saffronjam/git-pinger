import { app, nativeTheme, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ConfigManager } from './config-manager'
import { TokenStore } from './token-store'
import { Poller } from './poller'
import { RepoSyncer } from './repo-syncer'
import { registerIpcHandlers } from './ipc-handlers'
import { logger } from './logger'

/** Creates the main application window sized to 80% of the primary display. */
function createWindow(): BrowserWindow {
  const isDark = nativeTheme.shouldUseDarkColors
  const bg = isDark ? '#0a0a0a' : '#ffffff'
  const mainWindow = new BrowserWindow({
    width: 760,
    height: 580,
    minWidth: 760,
    minHeight: 580,
    show: false,
    autoHideMenuBar: true,
    title: '',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
      : {}),
    ...(process.platform === 'linux' ? { frame: false, icon: icon } : {}),
    backgroundColor: bg,
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

/** Installs .desktop file and icon for Linux desktop integration. */
function installLinuxDesktopEntry(): void {
  const homeDir = app.getPath('home')
  const appsDir = join(homeDir, '.local', 'share', 'applications')
  const iconsDir = join(homeDir, '.local', 'share', 'icons')
  const desktopFile = join(appsDir, 'git-pinger.desktop')

  if (existsSync(desktopFile)) return

  const appPath = process.env.APPIMAGE ?? process.execPath

  mkdirSync(appsDir, { recursive: true })
  mkdirSync(iconsDir, { recursive: true })

  const iconDest = join(iconsDir, 'git-pinger.png')
  copyFileSync(icon, iconDest)

  const entry = [
    '[Desktop Entry]',
    'Name=GitPinger',
    'Comment=GitHub and GitLab notification desktop app',
    `Exec=${appPath}`,
    `Icon=${iconDest}`,
    'Terminal=false',
    'Type=Application',
    'Categories=Development;Utility;',
    'StartupWMClass=git-pinger',
  ].join('\n')

  writeFileSync(desktopFile, entry + '\n')
  logger.info('Installed .desktop file and icon for Linux desktop integration')
}

app.whenReady().then(() => {
  logger.info(`App starting (platform=${process.platform}, version=${app.getVersion()})`)
  electronApp.setAppUserModelId('com.saffronjam.git-pinger')

  if (process.platform === 'linux') {
    installLinuxDesktopEntry()
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const configManager = new ConfigManager()
  const tokenStore = new TokenStore()
  const poller = new Poller(configManager, tokenStore)
  const repoSyncer = new RepoSyncer(configManager, tokenStore)

  const mainWindow = createWindow()
  logger.info('Main window created')

  configManager.setMainWindow(mainWindow)
  poller.setMainWindow(mainWindow)
  repoSyncer.setMainWindow(mainWindow)

  registerIpcHandlers(configManager, tokenStore, poller, repoSyncer, mainWindow)

  const config = configManager.get()
  const hasConnections = config.connections.github !== null || config.connections.gitlab !== null
  if (hasConnections) {
    logger.info('Connections found, starting repo syncer')
    repoSyncer.start()
    if (config.monitoredProjects.length > 0) {
      logger.info(`Starting poller for ${config.monitoredProjects.length} projects`)
      poller.start()
    }
  } else {
    logger.info('No connections configured, waiting for onboarding')
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
