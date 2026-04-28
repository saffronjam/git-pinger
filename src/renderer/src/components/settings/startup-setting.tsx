import { useCallback, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface StartupSettingProps {
  runAtLogin: boolean
}

/** macOS-only toggle for launching GitPinger automatically at login (hidden, tray-only). */
export function StartupSetting({ runAtLogin }: StartupSettingProps): ReactNode {
  const handleChange = useCallback((value: boolean) => {
    window.api.config.setRunAtLogin(value)
  }, [])

  return (
    <div className="flex items-center justify-between">
      <div>
        <Label>Run at login</Label>
        <p className="text-xs text-muted-foreground">
          Launch GitPinger in the background when you sign in
        </p>
      </div>
      <Switch checked={runAtLogin} onCheckedChange={handleChange} />
    </div>
  )
}
