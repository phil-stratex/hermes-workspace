import { DesktopVncIframe, DEFAULT_VNC_URL } from '@/components/desktop-panel/desktop-vnc-iframe'

/**
 * Full-screen Desktop view. Embeds the OpenHands noVNC client so Phil can
 * watch (and, when focused, interact with) the sandboxed xfce4 desktop that
 * Hermes workers operate via Computer-Use tools.
 */
export function DesktopScreen() {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--theme-bg)]">
      <header className="flex items-center justify-between border-b border-[var(--theme-border)] bg-[var(--theme-surface)] px-4 py-3">
        <div className="flex flex-col">
          <h1 className="text-sm font-semibold text-[var(--theme-text)]">
            Hermes Desktop
          </h1>
          <p className="text-[11px] text-[var(--theme-muted)]">
            Live-View des OpenHands-Sandbox (xfce4 + Chromium). Workers steuern den
            Desktop via Computer-Use Tools — du schaust live zu.
          </p>
        </div>
        <div className="hidden text-[10px] text-[var(--theme-muted)] md:flex md:flex-col md:items-end">
          <span>
            noVNC{' '}
            <a
              href={DEFAULT_VNC_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-[var(--theme-accent)]"
            >
              ↗ in neuem Tab öffnen
            </a>
          </span>
          <span>
            Quelle: <code>openhands-agent</code> (Port 8002 im VPS, lokal 18002)
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 p-4">
        <DesktopVncIframe size="fullscreen" className="rounded-md shadow-inner" />
      </div>
    </div>
  )
}
