import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { AnimatedHeight } from '@/components/ui/animated-height'
import type { OAuthDeviceFlowStatus } from '../../../../shared/ipc'
import type { Provider } from '../../../../shared/provider'

type AuthMode = 'choose' | 'pat'
type GitLabHosting = 'cloud' | 'selfhosted'

interface ProviderAuthFormProps {
  provider: Provider
  instanceUrl?: string | undefined
  onInstanceUrlChange?: ((url: string) => void) | undefined
}

const PLACEHOLDER: Record<Provider, string> = {
  github: 'ghp_...',
  gitlab: 'glpat-...',
}

/** Unified auth form for both GitHub and GitLab — supports OAuth + PAT. */
export function ProviderAuthForm({
  provider,
  instanceUrl,
  onInstanceUrlChange,
}: ProviderAuthFormProps): ReactNode {
  const [mode, setMode] = useState<AuthMode>('choose')
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null)
  const [oauthStatus, setOauthStatus] = useState<OAuthDeviceFlowStatus | null>(null)
  const [gitlabHosting, setGitlabHosting] = useState<GitLabHosting>('cloud')
  const selfHostedInputRef = useRef<HTMLInputElement>(null)

  const label = provider === 'github' ? 'GitHub' : 'GitLab'
  const placeholder = PLACEHOLDER[provider]
  const effectiveInstanceUrl =
    provider === 'gitlab' && gitlabHosting === 'selfhosted'
      ? instanceUrl?.trim() || 'https://gitlab.com'
      : 'https://gitlab.com'

  useEffect(() => {
    window.api.auth.getOAuthAvailability().then((a) => setOauthAvailable(a[provider]))
    const unsub = window.api.on.oauthProgress(setOauthStatus)
    return unsub
  }, [provider])

  const handleHostingChange = useCallback(
    (value: string) => {
      const hosting = value as GitLabHosting
      setGitlabHosting(hosting)
      if (hosting === 'cloud') {
        onInstanceUrlChange?.('')
      } else {
        requestAnimationFrame(() => selfHostedInputRef.current?.focus())
      }
    },
    [onInstanceUrlChange],
  )

  const handleOAuth = useCallback(async () => {
    setConnecting(true)
    setError(null)
    try {
      if (provider === 'github') {
        await window.api.auth.startGitHubOAuth()
      } else {
        await window.api.auth.startGitLabOAuth()
      }
    } catch (err) {
      setError(String(err))
      setConnecting(false)
    }
  }, [provider])

  const handlePat = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!token.trim()) return
      setConnecting(true)
      setError(null)

      const result =
        provider === 'github'
          ? await window.api.auth.saveGitHubPat(token)
          : await window.api.auth.saveGitLabPat(token, effectiveInstanceUrl)

      if (!result.valid) {
        setError(result.error ?? 'Token validation failed')
        setConnecting(false)
      }
    },
    [provider, token, effectiveInstanceUrl],
  )

  const isOAuthPending = oauthStatus?.phase === 'awaiting_user' || oauthStatus?.phase === 'polling'
  const isOAuthError = oauthStatus?.phase === 'error'
  const showOAuth = oauthAvailable && (provider === 'github' || gitlabHosting === 'cloud')

  return (
    <AnimatedHeight>
      <div className="space-y-4">
        {provider === 'gitlab' && onInstanceUrlChange && (
          <RadioGroup value={gitlabHosting} onValueChange={handleHostingChange}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="cloud" id="gitlab-cloud" />
              <Label htmlFor="gitlab-cloud" className="font-normal">
                gitlab.com
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="selfhosted" id="gitlab-selfhosted" />
              <div className="flex flex-1 items-center gap-2">
                <Label htmlFor="gitlab-selfhosted" className="shrink-0 font-normal">
                  Self-hosted
                </Label>
                {gitlabHosting === 'selfhosted' && (
                  <Input
                    ref={selfHostedInputRef}
                    placeholder="https://gitlab.example.com"
                    value={instanceUrl}
                    onChange={(e) => onInstanceUrlChange(e.target.value)}
                    className="h-8 text-sm"
                  />
                )}
              </div>
            </div>
          </RadioGroup>
        )}

        {isOAuthPending && (
          <>
            <p className="text-sm text-muted-foreground">
              Enter this code on {label} to authorize:
            </p>
            <div className="rounded-md bg-muted p-4 text-center">
              <code className="text-2xl font-bold tracking-widest">{oauthStatus.userCode}</code>
            </div>
            <p className="text-xs text-muted-foreground">
              A browser window should have opened. If not, visit:{' '}
              <span className="font-medium">{oauthStatus.verificationUri}</span>
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Waiting for authorization...
            </div>
          </>
        )}

        {isOAuthError && (
          <>
            <p className="text-sm text-destructive">{oauthStatus.error}</p>
            <Button onClick={handleOAuth} className="w-full">
              Try again
            </Button>
          </>
        )}

        {!isOAuthPending && !isOAuthError && mode === 'choose' && (
          <>
            {showOAuth && (
              <>
                <Button onClick={handleOAuth} disabled={connecting} className="w-full">
                  {connecting && <Loader2 className="size-4 animate-spin" />}
                  Connect with {label}
                </Button>
                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <Separator className="flex-1" />
                </div>
              </>
            )}
            <Button variant="outline" onClick={() => setMode('pat')} className="w-full">
              Enter Personal Access Token
            </Button>
          </>
        )}

        {!isOAuthPending && !isOAuthError && mode === 'pat' && (
          <form onSubmit={handlePat} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pat-token">Personal Access Token</Label>
              <Input
                id="pat-token"
                type="password"
                placeholder={placeholder}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
            </div>
            {provider === 'github' && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>
                  Create a <span className="font-medium text-foreground">fine-grained</span> token
                  with permissions:
                </p>
                <div className="flex flex-wrap gap-1">
                  <code className="rounded bg-muted px-1.5 py-0.5">Pull requests: Read</code>
                </div>
              </div>
            )}
            {provider === 'gitlab' && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>Required scope:</p>
                <div className="flex flex-wrap gap-1">
                  <code className="rounded bg-muted px-1.5 py-0.5">read_api</code>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              {(showOAuth || oauthAvailable) && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setMode('choose')
                    setToken('')
                    setError(null)
                  }}
                  className="flex-1"
                >
                  Back
                </Button>
              )}
              <Button type="submit" disabled={connecting || !token.trim()} className="flex-1">
                {connecting && <Loader2 className="size-4 animate-spin" />}
                Connect
              </Button>
            </div>
          </form>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </AnimatedHeight>
  )
}
