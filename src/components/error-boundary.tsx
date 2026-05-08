import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { reportClientError } from '@/lib/client-error-reporter'

type ErrorBoundaryProps = {
  children: ReactNode
  className?: string
  title?: string
  description?: string
  /** Optional context tag — e.g. route name — included in the report. */
  context?: Record<string, unknown>
}

type ErrorBoundaryState = {
  error: Error | null
  /** Server-side report ID — shown in the Prod fallback so the user can
   *  cite it when escalating. Backed by the `/api/errors/client` POST
   *  response. Null until reporting completes (or if it fails). */
  errorId: string | null
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
    errorId: null,
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Keep the existing console.error so dev-tools surface the throw too —
    // backend persistence is additive, not a replacement.
    console.error('Unhandled UI error', error, errorInfo)
    void reportClientError({
      message: error.message || 'React render error',
      stack: error.stack,
      context: {
        ...this.props.context,
        componentStack: errorInfo.componentStack,
      },
    }).then((res) => {
      if (res?.id) this.setState({ errorId: res.id })
    })
  }

  reloadPage() {
    if (typeof window === 'undefined') return
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const title = this.props.title ?? 'Something went wrong'
    const description =
      this.props.description ??
      'The chat encountered an unexpected issue. Reload to try again.'
    const isDev = import.meta.env.DEV

    return (
      <div
        className={cn(
          'flex h-full min-h-0 items-center justify-center bg-primary-50 p-6',
          this.props.className,
        )}
      >
        <div className="w-full max-w-md rounded-xl border border-primary-200 bg-primary-100 p-6 text-center shadow-sm">
          <h2 className="text-balance text-xl font-medium text-primary-900">
            {title}
          </h2>
          <p className="mt-2 text-pretty text-sm text-primary-700">
            {description}
          </p>
          {this.state.errorId ? (
            <p className="mt-2 text-[11px] text-primary-700">
              Report-ID: <code>{this.state.errorId}</code>
            </p>
          ) : null}
          {isDev && this.state.error ? (
            <pre className="mt-3 max-h-32 overflow-auto rounded bg-red-50 p-2 text-left text-[10px] text-red-800">
              {this.state.error.message}
              {'\n'}
              {this.state.error.stack?.split('\n').slice(0, 5).join('\n')}
            </pre>
          ) : null}
          <div className="mt-5 flex justify-center">
            <Button onClick={() => this.reloadPage()}>Reload</Button>
          </div>
        </div>
      </div>
    )
  }
}
