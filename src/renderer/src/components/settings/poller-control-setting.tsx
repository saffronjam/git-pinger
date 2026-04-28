import { useCallback, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { usePollerStatus } from '@/hooks/use-poller-status'

/** Pause / resume the poller. Surfaces the same control as the tray menu's Pause/Resume. */
export function PollerControlSetting(): ReactNode {
  const status = usePollerStatus()
  const running = status?.running ?? false

  const handleChange = useCallback((value: boolean) => {
    if (value) window.api.poller.start()
    else window.api.poller.stop()
  }, [])

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label>Polling</Label>
        <p className="text-xs text-muted-foreground">
          Pause to stop checking for new events. Repo list keeps syncing.
        </p>
      </div>
      <Switch checked={running} onCheckedChange={handleChange} />
    </div>
  )
}
