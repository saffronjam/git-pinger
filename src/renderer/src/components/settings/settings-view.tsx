import { useCallback, useState, type ReactNode } from 'react'
import { ArrowLeft, Bell, Check } from 'lucide-react'
import { GitPingerLogo } from '@/components/icons/gitpinger-logo'
import { AppShell } from '@/components/layout/app-shell'
import { AppHeader } from '@/components/layout/app-header'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useConfig } from '@/hooks/use-config'
import { ConnectionCard } from './connection-card'
import { PollerControlSetting } from './poller-control-setting'
import { PollIntervalSetting } from './poll-interval-setting'
import { LookbackSetting } from './lookback-setting'
import { ThemeSetting } from './theme-setting'
import { StartupSetting } from './startup-setting'
import { NotificationTemplateSetting } from './notification-template-setting'
import { LogViewer } from './log-viewer'
import { DEFAULT_TEMPLATES } from '../../../../shared/config'

interface SettingsViewProps {
  onBack: () => void
}

/** Settings view with connection management, polling config, and appearance. */
export function SettingsView({ onBack }: SettingsViewProps): ReactNode {
  const { config } = useConfig()
  const [gitlabUrl, setGitlabUrl] = useState('')
  const [testHint, setTestHint] = useState<string | null>(null)
  const [testSent, setTestSent] = useState(false)

  const handleIntervalChange = useCallback((seconds: number) => {
    window.api.config.setPollingInterval(seconds)
  }, [])

  const handleLookbackChange = useCallback((minutes: number) => {
    window.api.config.setLookbackMinutes(minutes)
  }, [])

  return (
    <AppShell>
      <AppHeader
        left={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="size-4" />
            </Button>
            <span className="text-lg font-semibold">Settings</span>
          </div>
        }
        center={
          <div className="flex items-center gap-2">
            <GitPingerLogo className="size-5 text-violet-500" />
            <span className="text-lg font-semibold">GitPinger</span>
          </div>
        }
      />

      <div className="space-y-6 overflow-auto p-4">
        <section>
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">Connections</h3>
          <div className="flex gap-3">
            <div className="flex-1">
              <ConnectionCard provider="github" connection={config?.connections.github ?? null} />
            </div>
            <div className="flex-1">
              <ConnectionCard
                provider="gitlab"
                connection={config?.connections.gitlab ?? null}
                gitlabUrl={gitlabUrl}
                onGitlabUrlChange={setGitlabUrl}
              />
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">Polling</h3>
          <PollerControlSetting />
          <PollIntervalSetting
            value={config?.polling.intervalSeconds ?? 60}
            onChange={handleIntervalChange}
          />
          <LookbackSetting
            value={config?.polling.lookbackMinutes ?? 5}
            onChange={handleLookbackChange}
          />
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">Appearance</h3>
          <ThemeSetting />
        </section>

        {window.api.window.platform === 'darwin' && (
          <>
            <Separator />
            <section className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">Startup</h3>
              <StartupSetting runAtLogin={config?.startup.runAtLogin ?? false} />
            </section>
          </>
        )}

        <Separator />

        <section className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">Notifications</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Test notification</p>
              <p className="text-xs text-muted-foreground">
                Send a test notification to verify they work
              </p>
              {testHint && <p className="mt-1 text-xs text-muted-foreground">{testHint}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await window.api.notifications.test()
                if (result.sent) {
                  setTestSent(true)
                  setTestHint(result.error)
                  setTimeout(() => setTestSent(false), 3000)
                } else {
                  setTestHint(result.error)
                }
              }}
            >
              {testSent ? <Check className="size-3.5" /> : <Bell className="size-3.5" />}
              {testSent ? 'Sent!' : 'Send test'}
            </Button>
          </div>

          <Separator />

          <NotificationTemplateSetting templates={config?.notifications ?? DEFAULT_TEMPLATES} />
        </section>

        <Separator />

        <section className="space-y-4">
          <h3 className="text-sm font-medium text-muted-foreground">Diagnostics</h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Application logs</p>
              <p className="text-xs text-muted-foreground">
                View internal logs for troubleshooting
              </p>
            </div>
            <LogViewer />
          </div>
        </section>

        <Separator />

        <section>
          <div className="rounded-lg border border-red-500/50 bg-red-500/5 p-4">
            <h3 className="mb-3 text-sm font-medium text-red-500">Danger Zone</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Reset settings</p>
                <p className="text-xs text-muted-foreground">
                  Restore all settings to factory defaults and remove all connections
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    Reset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all settings?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will restore all settings to their defaults, remove all provider
                      connections, and clear your monitored projects. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => window.api.config.reset()}
                    >
                      Reset everything
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </section>

        <p className="text-center text-xs text-muted-foreground">{__APP_VERSION__}</p>
      </div>
    </AppShell>
  )
}
