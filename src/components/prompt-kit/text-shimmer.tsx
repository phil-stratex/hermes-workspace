'use client'

import { cn } from '@/lib/utils'

export type TextShimmerProps = {
  as?: React.ElementType
  duration?: number
  spread?: number
  children: React.ReactNode
} & React.HTMLAttributes<HTMLElement>

export function TextShimmer({
  as = 'span',
  className,
  duration = 4,
  spread = 20,
  children,
  ...props
}: TextShimmerProps) {
  const dynamicSpread = Math.min(Math.max(spread, 5), 45)
  // Cast to a permissive elementType so style/children/className type-check
  // regardless of whether `as` is a string tag (e.g. 'span', 'div') or a
  // custom component. Using `any` here for the props bag is intentional —
  // narrowing the polymorphic `as` would require generic inference machinery
  // that is not worth the surface area for a presentational shimmer wrapper.
  const Component = as as React.ElementType<{
    className?: string
    style?: React.CSSProperties
    children?: React.ReactNode
  }>

  return (
    <Component
      className={cn(
        'bg-size-[200%_auto] bg-clip-text font-medium text-transparent',
        'animate-[shimmer_4s_infinite_linear]',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(to right, var(--color-primary-600) ${50 - dynamicSpread}%, var(--color-primary-950) 50%, var(--color-primary-600) ${50 + dynamicSpread}%)`,
        animationDuration: `${duration}s`,
      }}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </Component>
  )
}
