import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppConfig } from '../../../shared/config'

interface ConfigContextValue {
  config: AppConfig | null
  loading: boolean
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined)

interface AppConfigProviderProps {
  children: ReactNode
}

/** Provides reactive access to the app config, synced with the main process via IPC. */
export function AppConfigProvider({ children }: AppConfigProviderProps): ReactNode {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.config.get().then((c) => {
      setConfig(c)
      setLoading(false)
    })

    const unsub = window.api.on.configUpdated((c) => setConfig(c))
    return unsub
  }, [])

  return <ConfigContext value={{ config, loading }}>{children}</ConfigContext>
}

/** Returns the current app config and loading state. */
export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext)
  if (!context) {
    throw new Error('useConfig must be used within an AppConfigProvider')
  }
  return context
}
