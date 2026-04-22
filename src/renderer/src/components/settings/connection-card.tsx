import { useCallback, useState, type ReactNode } from 'react'
import { AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { GitHubIcon } from '@/components/icons/github-icon'
import { GitLabIcon } from '@/components/icons/gitlab-icon'
import { ProviderAuthForm } from '@/components/onboarding/provider-auth-form'
import type { Provider, ProviderConnection } from '../../../../shared/provider'

interface ConnectionCardProps {
  provider: Provider
  connection: ProviderConnection | null
  gitlabUrl?: string | undefined
  onGitlabUrlChange?: ((url: string) => void) | undefined
}

/** Shows a provider's connection status with connect/disconnect capability. */
export function ConnectionCard({
  provider,
  connection,
  gitlabUrl,
  onGitlabUrlChange,
}: ConnectionCardProps): ReactNode {
  const [disconnecting, setDisconnecting] = useState(false)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    await window.api.auth.removeProvider(provider)
    setDisconnecting(false)
    setDisconnectDialogOpen(false)
  }, [provider])

  const label = provider === 'github' ? 'GitHub' : 'GitLab'
  const Icon = provider === 'github' ? GitHubIcon : GitLabIcon
  const needsReauth = connection?.needsReauth === true

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <Icon className="size-5 shrink-0" />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{label}</span>
            {connection &&
              (needsReauth ? (
                <Badge className="bg-amber-500/15 text-amber-500 px-1.5 py-0 text-[10px] hover:bg-amber-500/15">
                  <AlertTriangle className="mr-1 size-3" />
                  Token expired
                </Badge>
              ) : (
                <Badge className="bg-emerald-500/15 text-emerald-500 px-1.5 py-0 text-[10px] hover:bg-emerald-500/15">
                  Connected
                </Badge>
              ))}
          </div>
          <p className={`text-xs ${connection ? 'text-muted-foreground' : 'invisible'}`}>
            {connection
              ? connection.provider === 'gitlab'
                ? `${connection.instanceUrl} · ${connection.username}`
                : connection.username
              : '\u00A0'}
          </p>
        </div>
      </div>
      {connection ? (
        <div className="flex items-center gap-2">
          {needsReauth && (
            <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-500/40 text-amber-500 hover:border-amber-500 hover:text-amber-500"
                >
                  <RefreshCw className="size-3.5" />
                  Reconnect
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Icon className="size-5" />
                    Reconnect {label}
                  </DialogTitle>
                  <DialogDescription>
                    Your {label} token has expired. Authenticate again to resume monitoring.
                  </DialogDescription>
                </DialogHeader>
                <ProviderAuthForm
                  provider={provider}
                  instanceUrl={provider === 'gitlab' ? gitlabUrl : undefined}
                  onInstanceUrlChange={provider === 'gitlab' ? onGitlabUrlChange : undefined}
                />
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="border-destructive/40 text-destructive hover:border-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Icon className="size-5" />
                  Disconnect {label}?
                </DialogTitle>
                <DialogDescription>
                  This will remove your {label} connection and stop monitoring all {label}{' '}
                  repositories. Your token will be deleted.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDisconnectDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
                  Disconnect
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="size-3" />
              Connect
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Icon className="size-5" />
                Connect {label}
              </DialogTitle>
              <DialogDescription>
                Add your {label} account to monitor repositories.
              </DialogDescription>
            </DialogHeader>
            <ProviderAuthForm
              provider={provider}
              instanceUrl={provider === 'gitlab' ? gitlabUrl : undefined}
              onInstanceUrlChange={provider === 'gitlab' ? onGitlabUrlChange : undefined}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
