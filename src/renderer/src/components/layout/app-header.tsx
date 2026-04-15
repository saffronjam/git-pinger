import type { ReactNode } from 'react'
import { usePlatform } from '@/hooks/use-platform'
import { WindowControls } from './window-controls'

interface AppHeaderProps {
  left?: ReactNode | undefined
  center?: ReactNode | undefined
  right?: ReactNode | undefined
  children?: ReactNode | undefined
}

/** Application header bar with window drag region support and optional centered title. */
export function AppHeader({ left, center, right, children }: AppHeaderProps): ReactNode {
  const platform = usePlatform()
  const isLinux = platform === 'linux'
  const pl = isLinux ? 'pl-4' : 'pl-20'

  if (children) {
    return (
      <header
        className={`drag-region flex h-12 shrink-0 items-center justify-between border-b pr-4 ${pl}`}
      >
        {children}
        {isLinux && <WindowControls />}
      </header>
    )
  }

  return (
    <header className={`drag-region relative flex h-12 shrink-0 items-center border-b pr-4 ${pl}`}>
      <div className="z-10">{left}</div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {center}
      </div>
      <div className="z-10 ml-auto flex items-center gap-2">
        {right}
        {isLinux && <WindowControls />}
      </div>
    </header>
  )
}
