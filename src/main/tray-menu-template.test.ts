import { describe, expect, test } from 'bun:test'
import type { Provider } from '../shared/provider'
import { buildTrayMenuTemplate, type TrayMenuCallbacks } from './tray-menu-template'
import type { TrayState } from './tray-state'

function noopCallbacks(): TrayMenuCallbacks {
  return {
    onShowWindow: () => {},
    onPauseToggle: () => {},
    onToggleRunAtLogin: () => {},
    onReconnect: () => {},
    onQuit: () => {},
  }
}

function baseState(overrides: Partial<TrayState> = {}): TrayState {
  return {
    statusText: 'Polling',
    hasAnyConnection: true,
    pollerRunning: true,
    reconnectProviders: [],
    runAtLogin: false,
    ...overrides,
  }
}

const labels = (items: ReturnType<typeof buildTrayMenuTemplate>): string[] =>
  items.map((i) => i.label ?? `<${i.type ?? 'normal'}>`)

describe('buildTrayMenuTemplate', () => {
  test('shows Pause polling when poller is running', () => {
    const items = buildTrayMenuTemplate(baseState({ pollerRunning: true }), noopCallbacks())
    expect(labels(items)).toContain('Pause polling')
    expect(labels(items)).not.toContain('Resume polling')
  })

  test('shows Resume polling when poller is stopped (and connected)', () => {
    const items = buildTrayMenuTemplate(
      baseState({ pollerRunning: false, statusText: 'Paused' }),
      noopCallbacks(),
    )
    expect(labels(items)).toContain('Resume polling')
    expect(labels(items)).not.toContain('Pause polling')
  })

  test('omits Pause/Resume entry when not connected', () => {
    const items = buildTrayMenuTemplate(
      baseState({ hasAnyConnection: false, pollerRunning: false, statusText: 'Not connected' }),
      noopCallbacks(),
    )
    expect(labels(items)).not.toContain('Pause polling')
    expect(labels(items)).not.toContain('Resume polling')
  })

  test('Open at login checkbox reflects runAtLogin', () => {
    const off = buildTrayMenuTemplate(baseState({ runAtLogin: false }), noopCallbacks())
    const on = buildTrayMenuTemplate(baseState({ runAtLogin: true }), noopCallbacks())
    const offItem = off.find((i) => i.label === 'Open at login')
    const onItem = on.find((i) => i.label === 'Open at login')
    expect(offItem?.type).toBe('checkbox')
    expect(offItem?.checked).toBe(false)
    expect(onItem?.checked).toBe(true)
  })

  test('Reconnect items appear only for providers with needsReauth', () => {
    const onlyGitLab = buildTrayMenuTemplate(
      baseState({ reconnectProviders: ['gitlab'] }),
      noopCallbacks(),
    )
    expect(labels(onlyGitLab)).toContain('Reconnect GitLab')
    expect(labels(onlyGitLab)).not.toContain('Reconnect GitHub')

    const both = buildTrayMenuTemplate(
      baseState({ reconnectProviders: ['github', 'gitlab'] }),
      noopCallbacks(),
    )
    expect(labels(both)).toContain('Reconnect GitHub')
    expect(labels(both)).toContain('Reconnect GitLab')
  })

  test('no Reconnect items when reconnectProviders is empty', () => {
    const items = buildTrayMenuTemplate(baseState({ reconnectProviders: [] }), noopCallbacks())
    expect(labels(items).filter((l) => l.startsWith('Reconnect'))).toEqual([])
  })

  test('first item is the disabled status header reflecting statusText', () => {
    const items = buildTrayMenuTemplate(
      baseState({ statusText: 'Token expired — reconnect' }),
      noopCallbacks(),
    )
    expect(items[0]?.label).toBe('GitPinger — Token expired — reconnect')
    expect(items[0]?.enabled).toBe(false)
  })

  test('callbacks fire when their items are clicked', () => {
    const calls: string[] = []
    const reconnectCalls: Provider[] = []
    const items = buildTrayMenuTemplate(baseState({ reconnectProviders: ['github'] }), {
      onShowWindow: () => calls.push('show'),
      onPauseToggle: () => calls.push('pause'),
      onToggleRunAtLogin: () => calls.push('login'),
      onReconnect: (p) => reconnectCalls.push(p),
      onQuit: () => calls.push('quit'),
    })
    items.find((i) => i.label === 'Open Window')?.click?.()
    items.find((i) => i.label === 'Pause polling')?.click?.()
    items.find((i) => i.label === 'Open at login')?.click?.()
    items.find((i) => i.label === 'Reconnect GitHub')?.click?.()
    items.find((i) => i.label === 'Quit GitPinger')?.click?.()
    expect(calls).toEqual(['show', 'pause', 'login', 'quit'])
    expect(reconnectCalls).toEqual(['github'])
  })
})
