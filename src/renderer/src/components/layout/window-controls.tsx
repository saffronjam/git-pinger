import { type ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'

/** Native-style window control buttons for frameless Linux windows. */
export function WindowControls(): ReactNode {
  return (
    <div className="flex items-center">
      <button
        type="button"
        className="hover:bg-muted flex h-8 w-10 items-center justify-center transition-colors"
        onClick={() => window.api.window.minimize()}
      >
        <Minus className="size-3.5" />
      </button>
      <button
        type="button"
        className="hover:bg-muted flex h-8 w-10 items-center justify-center transition-colors"
        onClick={() => window.api.window.maximize()}
      >
        <Square className="size-3" />
      </button>
      <button
        type="button"
        className="hover:bg-destructive hover:text-destructive-foreground flex h-8 w-10 items-center justify-center transition-colors"
        onClick={() => window.api.window.close()}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
