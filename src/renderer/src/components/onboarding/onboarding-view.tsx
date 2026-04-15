import { useState, type ReactNode } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { WindowControls } from '@/components/layout/window-controls'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { GitHubIcon } from '@/components/icons/github-icon'
import { GitLabIcon } from '@/components/icons/gitlab-icon'
import { GitPingerLogo } from '@/components/icons/gitpinger-logo'
import { usePlatform } from '@/hooks/use-platform'
import { ProviderAuthForm } from './provider-auth-form'

/** Onboarding screen shown when no providers are connected. */
export function OnboardingView(): ReactNode {
  const [gitlabUrl, setGitlabUrl] = useState('')
  const platform = usePlatform()

  return (
    <AppShell>
      <div className="drag-region flex h-12 shrink-0 items-center justify-end">
        {platform === 'linux' && <WindowControls />}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
        <div className="flex items-center gap-3">
          <GitPingerLogo className="size-10 text-violet-500" />
          <span className="text-3xl font-bold">GitPinger</span>
        </div>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Connect a Provider</CardTitle>
            <CardDescription>
              Add your GitHub or GitLab account to start receiving notifications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="github">
              <TabsList className="w-full">
                <TabsTrigger value="github" className="flex-1 gap-1.5">
                  <GitHubIcon className="size-4" />
                  GitHub
                </TabsTrigger>
                <TabsTrigger value="gitlab" className="flex-1 gap-1.5">
                  <GitLabIcon className="size-4" />
                  GitLab
                </TabsTrigger>
              </TabsList>
              <TabsContent value="github" className="mt-4">
                <ProviderAuthForm provider="github" />
              </TabsContent>
              <TabsContent value="gitlab" className="mt-4">
                <ProviderAuthForm
                  provider="gitlab"
                  instanceUrl={gitlabUrl}
                  onInstanceUrlChange={setGitlabUrl}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
