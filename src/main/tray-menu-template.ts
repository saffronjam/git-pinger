import type { Provider } from '../shared/provider'
import type { TrayState } from './tray-state'

export interface TrayMenuCallbacks {
  onShowWindow: () => void
  onPauseToggle: () => void
  onToggleRunAtLogin: () => void
  onReconnect: (provider: Provider) => void
  onQuit: () => void
}

export interface MenuItemTemplate {
  label?: string
  type?: 'normal' | 'separator' | 'checkbox'
  enabled?: boolean
  checked?: boolean
  click?: () => void
}

const PROVIDER_LABELS: Record<Provider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
}

/**
 * Builds the tray context-menu template from a resolved state and a set of callbacks.
 * Returns a plain template array compatible with Electron's `Menu.buildFromTemplate` —
 * pure function, no Electron import, no IO.
 */
export function buildTrayMenuTemplate(
  state: TrayState,
  callbacks: TrayMenuCallbacks,
): MenuItemTemplate[] {
  const items: MenuItemTemplate[] = [
    { label: `GitPinger — ${state.statusText}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Window', click: callbacks.onShowWindow },
  ]

  if (state.hasAnyConnection) {
    items.push({
      label: state.pollerRunning ? 'Pause polling' : 'Resume polling',
      click: callbacks.onPauseToggle,
    })
  }

  items.push({ type: 'separator' })
  items.push({
    label: 'Open at login',
    type: 'checkbox',
    checked: state.runAtLogin,
    click: callbacks.onToggleRunAtLogin,
  })

  if (state.reconnectProviders.length > 0) {
    items.push({ type: 'separator' })
    for (const provider of state.reconnectProviders) {
      items.push({
        label: `Reconnect ${PROVIDER_LABELS[provider]}`,
        click: () => callbacks.onReconnect(provider),
      })
    }
  }

  items.push({ type: 'separator' })
  items.push({ label: 'Quit GitPinger', click: callbacks.onQuit })

  return items
}
