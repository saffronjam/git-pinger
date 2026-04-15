import { useEffect, useRef, useState, type ReactNode } from 'react'

interface AnimatedHeightProps {
  children: ReactNode
  className?: string
}

/** Smoothly animates its height when children change size. */
export function AnimatedHeight({ children, className }: AnimatedHeightProps): ReactNode {
  const innerRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  const [style, setStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    const inner = innerRef.current
    if (!inner) return

    const update = (): void => {
      const h = inner.getBoundingClientRect().height
      if (firstRender.current) {
        firstRender.current = false
        setStyle({ height: h, overflow: 'hidden' })
      } else {
        setStyle({ height: h, overflow: 'hidden', transition: 'height 200ms ease-in-out' })
      }
    }

    const resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(inner)

    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div className={className} style={style}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
