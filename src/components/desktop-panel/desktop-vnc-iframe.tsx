import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * URL for the noVNC web client served by the OpenHands Agent Server.
 *
 * Default expects users to reach the VPS via SSH-tunnel `-L 18002:127.0.0.1:18002`
 * (same pattern as the existing workspace port 3000 tunnel). Override at build
 * time with `VITE_OPENHANDS_VNC_URL` to point at a Traefik-exposed subdomain.
 */
const DEFAULT_VNC_URL =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((import.meta as any).env?.VITE_OPENHANDS_VNC_URL as string | undefined) ??
  'http://localhost:18002/vnc.html?autoconnect=1&resize=remote'

type DesktopVncIframeProps = {
  /** 'fullscreen' fills its container, 'mini' is height-capped for in-chat use. */
  size?: 'fullscreen' | 'mini'
  className?: string
  /** Optional URL override (e.g. for tests). */
  url?: string
}

/**
 * Embedded noVNC live-view of the OpenHands Agent Server desktop.
 *
 * Renders an iframe pointed at the noVNC web client. Phil watches Hermes
 * workers operate Chromium / xfce4 in real time. No keyboard/mouse input is
 * captured from the iframe by default; for interactive use Phil opens the
 * standalone `/desktop` route or the OpenHands tab in a browser.
 */
export function DesktopVncIframe({
  size = 'fullscreen',
  className,
  url,
}: DesktopVncIframeProps) {
  const [errored, setErrored] = useState(false)
  const effectiveUrl = url ?? DEFAULT_VNC_URL

  if (errored) {
    return (
      <div
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border border-amber-400/35 bg-amber-500/5 p-6 text-center text-sm text-amber-200',
          className,
        )}
      >
        <span className="font-semibold">OpenHands-Desktop nicht erreichbar</span>
        <span className="max-w-sm text-xs text-amber-100/80">
          Stelle sicher dass der <code>openhands-agent</code> Container auf dem VPS läuft
          und ein SSH-Tunnel auf Port <code>18002</code> aktiv ist
          (<code>ssh -L 18002:127.0.0.1:18002 root@&lt;vps&gt;</code>).
        </span>
        <span className="text-[10px] text-amber-100/60">
          URL: <code>{effectiveUrl}</code>
        </span>
      </div>
    )
  }

  return (
    <iframe
      title="OpenHands Desktop (noVNC)"
      src={effectiveUrl}
      onError={() => setErrored(true)}
      className={cn(
        'block w-full border-0 bg-zinc-900',
        size === 'fullscreen' ? 'h-full min-h-[600px]' : 'aspect-video min-h-[260px]',
        className,
      )}
      // VNC needs same-origin or explicit allow. We're loading from a separate
      // origin (localhost:18002 vs the workspace origin) but the iframe is
      // sandboxed minimally so noVNC's JS + WebSocket work.
      sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
      allow="clipboard-read; clipboard-write"
    />
  )
}

export { DEFAULT_VNC_URL }
