import { app, nativeTheme, safeStorage, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ConfigManager } from './config-manager'
import { TokenStore } from './token-store'
import { Poller } from './poller'
import { RepoSyncer } from './repo-syncer'
import { AuthRefresher, type ProviderRefresher } from './auth-refresher'
import * as gitlabClient from './gitlab-client'
import { showNotification } from './notification-manager'
import { syncServicesToConfig } from './service-manager'
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
  const tokensDir = join(app.getPath('userData'), 'tokens')
  if (!existsSync(tokensDir)) mkdirSync(tokensDir, { recursive: true })
  const tokenStore = new TokenStore(join(tokensDir, 'tokens.enc'), safeStorage)

  for (const provider of ['github', 'gitlab'] as const) {
    const entry = tokenStore.getEntry(provider)
    logger.info('token-store.boot', {
      provider,
      present: entry !== null,
      kind: entry?.kind ?? null,
      hasRefreshToken: entry?.kind === 'oauth' && entry.refreshToken !== null,
      expiresAt: entry?.kind === 'oauth' ? entry.expiresAt : null,
    })
  }

  const gitlabClientId = import.meta.env.MAIN_VITE_GITLAB_CLIENT_ID as string | undefined
  logger.info('auth-refresher.config', {
    gitlabClientIdConfigured: gitlabClientId !== undefined && gitlabClientId.length > 0,
  })
  const authRefresher = new AuthRefresher({
    configManager,
    tokenStore,
    refreshers: {
      getRefresher: (provider): ProviderRefresher | null => {
        if (provider === 'gitlab' && gitlabClientId) {
          return (refreshToken) => gitlabClient.refreshOAuthToken(gitlabClientId, refreshToken)
        }
        return null
      },
    },
  })

  const poller = new Poller(configManager, tokenStore, authRefresher, showNotification)
  const repoSyncer = new RepoSyncer(configManager, tokenStore, authRefresher)

  let currentMainWindow: BrowserWindow | null = null

  function getMainWindow(): BrowserWindow | null {
    return currentMainWindow && !currentMainWindow.isDestroyed() ? currentMainWindow : null
  }

  function bootMainWindow(): BrowserWindow {
    const win = createWindow()
    currentMainWindow = win
    logger.info('Main window created')
    win.on('closed', () => {
      if (currentMainWindow === win) {
        currentMainWindow = null
        logger.info('Main window closed')
      }
    })
    configManager.setMainWindow(win)
    poller.setMainWindow(win)
    repoSyncer.setMainWindow(win)
    return win
  }

  bootMainWindow()

  registerIpcHandlers(configManager, tokenStore, poller, repoSyncer, getMainWindow)

  ;(async () => {
    for (const provider of ['github', 'gitlab'] as const) {
      try {
        await authRefresher.refreshIfExpired(provider)
      } catch (err) {
        logger.error('auth.proactive-refresh.threw', { provider, error: String(err) })
      }
    }
    syncServicesToConfig(configManager, poller, repoSyncer)
  })()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('App activated with no windows; re-creating main window')
      bootMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
