import { useEffect, useState } from 'react'
import type { PollerStatus } from '../../../shared/ipc'

/** Subscribes to poller status updates from the main process. */
export function usePollerStatus(): PollerStatus | null {
  const [status, setStatus] = useState<PollerStatus | null>(null)

  useEffect(() => {
    window.api.poller.getStatus().then(setStatus)
    const unsub = window.api.on.pollerStatusChanged(setStatus)
    return unsub
  }, [])

  return status
}
