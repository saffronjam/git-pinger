import '@/assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@/hooks/use-theme'
import { AppConfigProvider } from '@/hooks/use-config'
import { SyncProvider } from '@/hooks/use-sync'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import App from '@/app'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AppConfigProvider>
        <SyncProvider>
          <TooltipProvider delayDuration={400}>
            <App />
            <Toaster />
          </TooltipProvider>
        </SyncProvider>
      </AppConfigProvider>
    </ThemeProvider>
  </StrictMode>,
)
