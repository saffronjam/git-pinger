import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import type { Provider } from '../shared/provider'
import type { ConfigManager } from './config-manager'
import type { Poller } from './poller'
import type { RepoSyncer } from './repo-syncer'
import { logger } from './logger'
import { resolveTrayState } from './tray-state'
import { buildTrayMenuTemplate, type TrayMenuCallbacks } from './tray-menu-template'

export interface TrayManagerDeps {
  configManager: Pick<ConfigManager, 'get' | 'setRunAtLogin'>
  poller: Pick<Poller, 'getStatus' | 'start' | 'stop'>
  repoSyncer: Pick<RepoSyncer, 'getStatus'>
  showWindow: () => void
  reconnect: (provider: Provider) => void
  applyLoginItemSetting: () => void
  quit: () => void
  trayIconPath: string
}

/**
 * Manages the macOS menu bar tray icon and its context menu.
 * Refresh is cheap — call it whenever poller/syncer/config state changes.
 */
export class TrayManager {
  private tray: Tray | null = null

  constructor(private deps: TrayManagerDeps) {}

  /** Creates the Tray and renders the initial menu. */
  init(): void {
    if (this.tray) return
    const image = nativeImage.createFromPath(this.deps.trayIconPath)
    image.setTemplateImage(true)
    const size = image.getSize()
    logger.info('tray.init', {
      iconPath: this.deps.trayIconPath,
      iconLoaded: !image.isEmpty(),
      iconSize: `${size.width}x${size.height}`,
    })
    this.tray = new Tray(image)
    this.tray.setToolTip('GitPinger')
    this.refresh()
  }

  /** Recomputes the menu from current state and applies it. */
  refresh(): void {
    if (!this.tray) return
    const state = resolveTrayState(
      this.deps.configManager.get(),
      this.deps.poller.getStatus(),
      this.deps.repoSyncer.getStatus(),
    )
    const callbacks: TrayMenuCallbacks = {
      onShowWindow: this.deps.showWindow,
      onPauseToggle: () => {
        if (state.pollerRunning) this.deps.poller.stop()
        else this.deps.poller.start()
      },
      onToggleRunAtLogin: () => {
        const next = !state.runAtLogin
        this.deps.configManager.setRunAtLogin(next)
        this.deps.applyLoginItemSetting()
        this.refresh()
      },
      onReconnect: (provider) => this.deps.reconnect(provider),
      onQuit: this.deps.quit,
    }
    const template = buildTrayMenuTemplate(state, callbacks)
    this.tray.setContextMenu(Menu.buildFromTemplate(template as MenuItemConstructorOptions[]))
  }

  /** Destroys the Tray (called on app quit). */
  dispose(): void {
    this.tray?.destroy()
    this.tray = null
    logger.info('tray.dispose')
  }
}
