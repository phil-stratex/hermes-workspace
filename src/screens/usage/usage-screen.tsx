import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Activity04Icon,
  ChartBarLineIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CrownIcon,
  JusticeScale02Icon,
  MessageMultiple01Icon,
  RefreshIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

type SystemInfo = {
  ok: boolean
  env: Record<string, string>
  volumes: Array<{ path: string; exists: boolean }>
  dockerBridge: {
    configured: boolean
    ok: boolean
    stderr?: string
    tmuxAvailable?: boolean
  }
}

type UsageWindow = '24h' | '7d' | '30d' | 'all'

type UsageData = {
  ok: boolean
  window: UsageWindow
  generatedAt: number
  council: {
    total: number
    totalTokens: number
    perMode: Record<string, { count: number; tokens: number }>
    perChairman: Record<string, { count: number; tokens: number }>
    recent: Array<{
      id: string
      startedAt: number
      mode: string
      chairman: string
      totalTokens: number | null
      question: string
    }>
  }
  sessions: {
    total: number
    totalMessages: number
    perModel: Record<string, { count: number; messages: number }>
  }
}

const WINDOW_LABELS: Record<UsageWindow, string> = {
  '24h': 'Letzte 24 Std.',
  '7d': 'Letzte 7 Tage',
  '30d': 'Letzte 30 Tage',
  all: 'Gesamt',
}

export function UsageScreen() {
  const [win, setWin] = useState<UsageWindow>('7d')
  const usageQuery = useQuery({
    queryKey: ['usage', win],
    queryFn: async () => {
      const res = await fetch(`/api/usage?window=${win}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as UsageData
    },
    staleTime: 30_000,
  })

  const data = usageQuery.data
  const systemQuery = useQuery({
    queryKey: ['system-info'],
    queryFn: async () => {
      const res = await fetch('/api/system-info')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as SystemInfo
    },
    staleTime: 60_000,
  })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6 text-[var(--theme-text)]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-2.5">
            <HugeiconsIcon icon={ChartBarLineIcon} size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Usage</h1>
            <p className="text-sm text-[var(--theme-muted)]">
              Token-Verbrauch und Aktivität — Council + Hermes-Sessions.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => usageQuery.refetch()}
          className="flex items-center gap-1 rounded-lg border border-[var(--theme-border)] px-3 py-1.5 text-xs text-[var(--theme-muted)] hover:bg-[var(--theme-bg)]"
        >
          <HugeiconsIcon icon={RefreshIcon} size={14} />
          Aktualisieren
        </button>
      </header>

      <div className="flex gap-2">
        {(['24h', '7d', '30d', 'all'] as Array<UsageWindow>).map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWin(w)}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-xs font-medium',
              win === w
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)]'
                : 'border-[var(--theme-border)] hover:bg-[var(--theme-bg)]',
            )}
          >
            {WINDOW_LABELS[w]}
          </button>
        ))}
      </div>

      {usageQuery.isLoading ? (
        <p className="text-sm text-[var(--theme-muted)]">Lade Statistiken…</p>
      ) : usageQuery.isError ? (
        <p className="text-sm text-red-400">
          Fehler beim Laden: {(usageQuery.error as Error).message}
        </p>
      ) : !data ? null : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <StatCard
              icon={<HugeiconsIcon icon={JusticeScale02Icon} size={18} />}
              label="Council-Runs"
              value={data.council.total.toString()}
              hint={
                data.council.totalTokens > 0
                  ? `${formatNumber(data.council.totalTokens)} tokens`
                  : '0 tokens'
              }
            />
            <StatCard
              icon={<HugeiconsIcon icon={MessageMultiple01Icon} size={18} />}
              label="Hermes-Sessions"
              value={data.sessions.total.toString()}
              hint={`${data.sessions.totalMessages} Nachrichten`}
            />
            <StatCard
              icon={<HugeiconsIcon icon={Activity04Icon} size={18} />}
              label="Aktivität"
              value={`${data.council.total + data.sessions.total}`}
              hint={`im Zeitraum ${WINDOW_LABELS[win]}`}
            />
          </section>

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <HugeiconsIcon icon={JusticeScale02Icon} size={14} />
              Council nach Modus
            </h2>
            {Object.keys(data.council.perMode).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">
                Noch keine Council-Sessions im Zeitraum.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--theme-muted)]">
                  <tr>
                    <th className="py-1 text-left">Modus</th>
                    <th className="py-1 text-right">Runs</th>
                    <th className="py-1 text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.council.perMode)
                    .sort((a, b) => b[1].tokens - a[1].tokens)
                    .map(([mode, stats]) => (
                      <tr key={mode} className="border-t border-[var(--theme-border)]">
                        <td className="py-1.5 font-medium">{mode}</td>
                        <td className="py-1.5 text-right">{stats.count}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatNumber(stats.tokens)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <HugeiconsIcon icon={CrownIcon} size={14} />
              Council nach Chairman
            </h2>
            {Object.keys(data.council.perChairman).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">Keine Daten.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--theme-muted)]">
                  <tr>
                    <th className="py-1 text-left">Chairman</th>
                    <th className="py-1 text-right">Runs</th>
                    <th className="py-1 text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.council.perChairman)
                    .sort((a, b) => b[1].tokens - a[1].tokens)
                    .map(([chair, stats]) => (
                      <tr
                        key={chair}
                        className="border-t border-[var(--theme-border)]"
                      >
                        <td className="py-1.5 font-medium">{chair}</td>
                        <td className="py-1.5 text-right">{stats.count}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatNumber(stats.tokens)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <HugeiconsIcon icon={MessageMultiple01Icon} size={14} />
              Hermes-Sessions nach Modell
            </h2>
            {Object.keys(data.sessions.perModel).length === 0 ? (
              <p className="text-xs text-[var(--theme-muted)]">Keine Sessions.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-[var(--theme-muted)]">
                  <tr>
                    <th className="py-1 text-left">Modell</th>
                    <th className="py-1 text-right">Sessions</th>
                    <th className="py-1 text-right">Nachrichten</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.sessions.perModel)
                    .sort((a, b) => b[1].messages - a[1].messages)
                    .map(([model, stats]) => (
                      <tr
                        key={model}
                        className="border-t border-[var(--theme-border)]"
                      >
                        <td className="py-1.5 font-medium">{model}</td>
                        <td className="py-1.5 text-right">{stats.count}</td>
                        <td className="py-1.5 text-right">{stats.messages}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <section className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <HugeiconsIcon icon={Settings01Icon} size={14} />
          System
        </h2>
        {systemQuery.isLoading ? (
          <p className="text-xs text-[var(--theme-muted)]">Lade System-Status…</p>
        ) : systemQuery.isError ? (
          <p className="text-xs text-red-400">
            {(systemQuery.error as Error).message}
          </p>
        ) : systemQuery.data ? (
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(systemQuery.data.env).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs"
                >
                  <div className="font-mono text-[10px] uppercase text-[var(--theme-muted)]">
                    {key}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[var(--theme-text)]">
                    {value}
                  </div>
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold">Docker-Bridge</h3>
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                  systemQuery.data.dockerBridge.configured &&
                    systemQuery.data.dockerBridge.ok
                    ? 'border-green-500/40 bg-green-500/10'
                    : systemQuery.data.dockerBridge.configured
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-[var(--theme-border)] bg-[var(--theme-bg)]',
                )}
              >
                <HugeiconsIcon
                  icon={
                    systemQuery.data.dockerBridge.configured &&
                    systemQuery.data.dockerBridge.ok
                      ? CheckmarkCircle02Icon
                      : Cancel01Icon
                  }
                  size={14}
                />
                <span>
                  {systemQuery.data.dockerBridge.configured
                    ? systemQuery.data.dockerBridge.ok
                      ? `Aktiv${systemQuery.data.dockerBridge.tmuxAvailable ? ' · tmux verfügbar' : ' · tmux fehlt'}`
                      : `Konfiguriert aber blockiert: ${systemQuery.data.dockerBridge.stderr ?? 'unknown'}`
                    : 'Nicht konfiguriert (lokaler Modus)'}
                </span>
              </div>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold">Volumes</h3>
              <div className="space-y-1">
                {systemQuery.data.volumes.map((v) => (
                  <div
                    key={v.path}
                    className="flex items-center gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-1.5 text-[11px]"
                  >
                    <HugeiconsIcon
                      icon={v.exists ? CheckmarkCircle02Icon : Cancel01Icon}
                      size={12}
                      className={v.exists ? 'text-green-400' : 'text-red-400'}
                    />
                    <span className="font-mono">{v.path}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--theme-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? (
        <div className="mt-1 text-[11px] text-[var(--theme-muted)]">{hint}</div>
      ) : null}
    </div>
  )
}

function formatNumber(n: number): string {
  return n.toLocaleString('de-DE')
}
