import type { ReactNode } from 'react'

interface AppHeaderProps {
  left?: ReactNode | undefined
  center?: ReactNode | undefined
  right?: ReactNode | undefined
  children?: ReactNode | undefined
}

/** Application header bar with window drag region support and optional centered title. */
export function AppHeader({ left, center, right, children }: AppHeaderProps): ReactNode {
  if (children) {
    return (
      <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b pl-20 pr-4">
        {children}
      </header>
    )
  }

  return (
    <header className="drag-region relative flex h-12 shrink-0 items-center border-b pl-20 pr-4">
      <div className="z-10">{left}</div>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {center}
      </div>
      <div className="z-10 ml-auto">{right}</div>
    </header>
  )
}
