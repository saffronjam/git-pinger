import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useConfig } from '@/hooks/use-config'
import { OnboardingView } from '@/components/onboarding/onboarding-view'
import { MainView } from '@/components/main/main-view'
import { SettingsView } from '@/components/settings/settings-view'

type ActiveView = 'main' | 'settings'

const VIEW_HISTORY: ActiveView[] = ['main', 'settings']

/** Root application component — routes between onboarding, main, and settings views. */
function App(): ReactNode {
  const { config, loading } = useConfig()
  const [view, setView] = useState<ActiveView>('main')

  const navigateTo = useCallback((target: ActiveView) => {
    setView(target)
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      const currentIndex = VIEW_HISTORY.indexOf(view)

      if (e.button === 3) {
        e.preventDefault()
        if (currentIndex > 0) {
          setView(VIEW_HISTORY[currentIndex - 1]!)
        }
      } else if (e.button === 4) {
        e.preventDefault()
        if (currentIndex < VIEW_HISTORY.length - 1) {
          setView(VIEW_HISTORY[currentIndex + 1]!)
        }
      }
    }

    globalThis.addEventListener('mouseup', handler)
    return () => globalThis.removeEventListener('mouseup', handler)
  }, [view])

  if (loading || !config) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasConnection = config.connections.github !== null || config.connections.gitlab !== null

  if (!hasConnection) {
    return <OnboardingView />
  }

  if (view === 'settings') {
    return <SettingsView onBack={() => navigateTo('main')} />
  }

  return <MainView onOpenSettings={() => navigateTo('settings')} />
}

export default App
