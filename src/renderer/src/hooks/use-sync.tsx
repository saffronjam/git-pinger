import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AvailableProject } from '../../../shared/project'
import type { SyncStatus } from '../../../shared/ipc'

interface SyncContextValue {
  repos: AvailableProject[]
  status: SyncStatus | null
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined)

interface SyncProviderProps {
  children: ReactNode
}

/** Provides access to background-synced repo list and sync status. */
export function SyncProvider({ children }: SyncProviderProps): ReactNode {
  const [repos, setRepos] = useState<AvailableProject[]>([])
  const [status, setStatus] = useState<SyncStatus | null>(null)

  useEffect(() => {
    window.api.sync.getRepos().then(setRepos)
    window.api.sync.getStatus().then(setStatus)

    const unsubRepos = window.api.sync.onReposUpdated(setRepos)
    const unsubStatus = window.api.sync.onStatusChanged(setStatus)

    return () => {
      unsubRepos()
      unsubStatus()
    }
  }, [])

  return <SyncContext value={{ repos, status }}>{children}</SyncContext>
}

/** Returns the background-synced repos and sync status. */
export function useSync(): SyncContextValue {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider')
  }
  return context
}
