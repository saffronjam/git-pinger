import type { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

/** Outer layout wrapper for the application. */
export function AppShell({ children }: AppShellProps): ReactNode {
  return <div className="flex h-screen flex-col overflow-hidden">{children}</div>
}
