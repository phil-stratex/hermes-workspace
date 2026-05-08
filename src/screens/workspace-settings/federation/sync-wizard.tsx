import { useEffect, useState } from 'react'

type Peer = {
  id: string
  name: string
  remoteWorkspaceId: string
  syncedTypes: Array<string>
  status: 'connected' | 'disconnected' | 'error'
}

type DiffItem = {
  kind: 'memory' | 'skill' | 'session-snapshot'
  path: string
  op: 'add' | 'update' | 'delete'
  remoteSha256?: string
  localSha256?: string
}

type DiffConflict = {
  kind: 'memory' | 'skill' | 'session-snapshot'
  path: string
  localSha256: string
  remoteSha256: string
}

type DiffResult = {
  inItems: Array<DiffItem>
  outItems: Array<DiffItem>
  conflicts: Array<DiffConflict>
  warnings: {
    massInDelete: boolean
    massOutDelete: boolean
    detail: { inDeleteCount: number; outDeleteCount: number; inPoolSize: number; outPoolSize: number }
  }
}

type Resolution = 'local' | 'remote' | 'manual'

type Selection = {
  in: Set<string>          // accepted incoming-item paths
  conflicts: Map<string, Resolution>
}

type Step = 'connect' | 'diff' | 'apply' | 'done'

/**
 * 3-step Sync wizard. Plan B.3 — diff-preview is mandatory before
 * any apply. Mass-delete-warnings render as a red banner that the
 * operator has to acknowledge separately.
 */
export function SyncWizard({
  wsId,
  peer,
  onClose,
}: {
  wsId: string
  peer: Peer
  onClose: () => void
}) {
  const [step, setStep] = useState<Step>('connect')
  const [error, setError] = useState('')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [selection, setSelection] = useState<Selection>({ in: new Set(), conflicts: new Map() })
  const [massDeleteAcknowledged, setMassDeleteAcknowledged] = useState(false)
  const [applyResult, setApplyResult] = useState<{
    applied: { add: number; update: number; delete: number }
    skipped: Array<{ path: string; reason: string }>
    conflictsResolved: number
  } | null>(null)

  // ─── Step transitions ───────────────────────────────────────────

  useEffect(() => {
    if (step !== 'connect') return
    void runConnect()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runConnect(): Promise<void> {
    setError('')
    try {
      // The peer's status is updated server-side; we proceed on 200.
      const r = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/federation/connect/${encodeURIComponent(peer.id)}`,
        { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      if (!r.ok) {
        const body = await r.json() as { error?: string; reason?: string; details?: string }
        throw new Error(`${body.reason ?? body.error ?? 'connect failed'}: ${body.details ?? ''}`)
      }
      // Compute diff
      const dr = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/federation/diff/${encodeURIComponent(peer.id)}`,
        { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      const diffBody = await dr.json() as { ok: boolean; diff?: DiffResult; error?: string }
      if (!dr.ok || !diffBody.diff) throw new Error(diffBody.error ?? `HTTP ${dr.status}`)
      setDiff(diffBody.diff)
      // Default selection: accept every incoming item, no conflict resolution.
      setSelection({
        in: new Set(diffBody.diff.inItems.map((i) => i.path)),
        conflicts: new Map(),
      })
      setStep('diff')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbindung/Diff fehlgeschlagen')
    }
  }

  async function runApply(): Promise<void> {
    if (!diff) return
    setError('')
    setStep('apply')
    try {
      const selective: Array<{ path: string; resolve?: 'local' | 'remote'; remoteSha256?: string }> = []
      for (const item of diff.inItems) {
        if (selection.in.has(item.path)) {
          selective.push({ path: item.path, remoteSha256: item.remoteSha256 })
        }
      }
      for (const conflict of diff.conflicts) {
        const resolution = selection.conflicts.get(conflict.path)
        if (resolution === 'local' || resolution === 'remote') {
          selective.push({ path: conflict.path, resolve: resolution, remoteSha256: conflict.remoteSha256 })
        }
      }
      const r = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/federation/apply/${encodeURIComponent(peer.id)}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selective }),
        },
      )
      const body = await r.json() as { ok: boolean; result?: typeof applyResult; error?: string }
      if (!r.ok || !body.result) throw new Error(body.error ?? `HTTP ${r.status}`)
      setApplyResult(body.result)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply fehlgeschlagen')
      setStep('diff')
    } finally {
      // Disconnect when wizard closes — we treat each Sync as a one-shot.
      void fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/federation/disconnect/${encodeURIComponent(peer.id)}`,
        { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      ).catch(() => null)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <Modal title={`Sync — ${peer.name}`} onClose={onClose}>
      <Steps step={step} />

      {error && <ErrorBox>{error}</ErrorBox>}

      {step === 'connect' && (
        <div className="py-12 text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" />
          <p className="text-sm text-primary-700">Verbinde mit {peer.name} und berechne Diff …</p>
        </div>
      )}

      {step === 'diff' && diff && (
        <DiffStep
          diff={diff}
          selection={selection}
          onSelectionChange={setSelection}
          massDeleteAcknowledged={massDeleteAcknowledged}
          onAcknowledgeMassDelete={() => setMassDeleteAcknowledged(true)}
          onApply={runApply}
          onClose={onClose}
        />
      )}

      {step === 'apply' && (
        <div className="py-12 text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" />
          <p className="text-sm text-primary-700">Applying …</p>
        </div>
      )}

      {step === 'done' && applyResult && (
        <ApplyResultStep result={applyResult} diff={diff!} onClose={onClose} />
      )}
    </Modal>
  )
}

// ─── Diff step ──────────────────────────────────────────────────────

function DiffStep({
  diff,
  selection,
  onSelectionChange,
  massDeleteAcknowledged,
  onAcknowledgeMassDelete,
  onApply,
  onClose,
}: {
  diff: DiffResult
  selection: Selection
  onSelectionChange: (s: Selection) => void
  massDeleteAcknowledged: boolean
  onAcknowledgeMassDelete: () => void
  onApply: () => void
  onClose: () => void
}) {
  const massDeleteWarning = diff.warnings.massInDelete || diff.warnings.massOutDelete
  const allConflictsResolved = diff.conflicts.every((c) => {
    const r = selection.conflicts.get(c.path)
    return r === 'local' || r === 'remote'
  })
  const blocked = (massDeleteWarning && !massDeleteAcknowledged) || !allConflictsResolved

  function toggleIn(path: string) {
    const next = new Set(selection.in)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onSelectionChange({ ...selection, in: next })
  }
  function setConflict(path: string, resolve: Resolution) {
    const next = new Map(selection.conflicts)
    next.set(path, resolve)
    onSelectionChange({ ...selection, conflicts: next })
  }

  return (
    <div className="space-y-4">
      {massDeleteWarning && (
        <MassDeleteWarning
          detail={diff.warnings.detail}
          massIn={diff.warnings.massInDelete}
          massOut={diff.warnings.massOutDelete}
          acknowledged={massDeleteAcknowledged}
          onAcknowledge={onAcknowledgeMassDelete}
        />
      )}

      <Section title={`Ankommend (${diff.inItems.length})`} count={selection.in.size}>
        {diff.inItems.length === 0 ? (
          <Empty>Keine Änderungen vom Peer.</Empty>
        ) : (
          <ItemTable>
            {diff.inItems.map((it) => (
              <ItemRow
                key={'in-' + it.path}
                kind={it.kind}
                op={it.op}
                path={it.path}
                checked={selection.in.has(it.path)}
                onToggle={() => toggleIn(it.path)}
              />
            ))}
          </ItemTable>
        )}
      </Section>

      <Section title={`Ausgehend (${diff.outItems.length})`} hint="Werden beim nächsten Sync auf dem Peer übernommen — hier nur informativ angezeigt." count={null}>
        {diff.outItems.length === 0 ? <Empty>Keine lokalen Änderungen.</Empty> : (
          <ItemTable>
            {diff.outItems.map((it) => (
              <ItemRow key={'out-' + it.path} kind={it.kind} op={it.op} path={it.path} readOnly />
            ))}
          </ItemTable>
        )}
      </Section>

      <Section title={`Konflikte (${diff.conflicts.length})`} count={null}>
        {diff.conflicts.length === 0 ? <Empty>Keine Konflikte.</Empty> : (
          <div className="space-y-2">
            {diff.conflicts.map((c) => (
              <ConflictRow
                key={c.path}
                conflict={c}
                resolution={selection.conflicts.get(c.path)}
                onResolve={(r) => setConflict(c.path, r)}
              />
            ))}
          </div>
        )}
      </Section>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm">
          Cancel & Disconnect
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={blocked}
          title={
            !allConflictsResolved
              ? 'Bitte alle Konflikte aufzulösen (Lokal / Remote / Manuell)'
              : massDeleteWarning && !massDeleteAcknowledged
                ? 'Bitte Mass-Delete-Warnung bestätigen'
                : undefined
          }
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
        >
          Apply ({selection.in.size + diff.conflicts.filter((c) => selection.conflicts.get(c.path) === 'remote').length})
        </button>
      </div>
    </div>
  )
}

// ─── Result step ────────────────────────────────────────────────────

function ApplyResultStep({
  result,
  diff,
  onClose,
}: {
  result: { applied: { add: number; update: number; delete: number }; skipped: Array<{ path: string; reason: string }>; conflictsResolved: number }
  diff: DiffResult
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4">
        <h4 className="mb-2 text-sm font-semibold text-green-800">Sync erfolgreich</h4>
        <ul className="space-y-1 text-xs text-green-800/90">
          <li>{result.applied.add} neue Einträge</li>
          <li>{result.applied.update} Updates</li>
          <li>{result.applied.delete} Löschungen</li>
          <li>{result.conflictsResolved} Konflikte resolved</li>
        </ul>
      </div>
      {result.skipped.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <h4 className="mb-2 text-sm font-semibold text-amber-800">{result.skipped.length} skipped</h4>
          <ul className="space-y-1 text-xs text-amber-800/90">
            {result.skipped.slice(0, 8).map((s, i) => (
              <li key={i} className="font-mono">{s.path}: <span className="font-sans">{s.reason}</span></li>
            ))}
            {result.skipped.length > 8 && <li>… und {result.skipped.length - 8} weitere</li>}
          </ul>
        </div>
      )}
      <div className="text-xs text-primary-500">
        Tunnel ist geschlossen. Letzter Sync-Stand wurde im Peer-Eintrag gespeichert.
      </div>
      <div className="flex justify-end pt-2">
        <button type="button" onClick={onClose} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white">Schließen</button>
      </div>
      {void diff}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────

function MassDeleteWarning({
  detail,
  massIn,
  massOut,
  acknowledged,
  onAcknowledge,
}: {
  detail: { inDeleteCount: number; outDeleteCount: number; inPoolSize: number; outPoolSize: number }
  massIn: boolean
  massOut: boolean
  acknowledged: boolean
  onAcknowledge: () => void
}) {
  return (
    <div className="rounded-xl border-2 border-red-300 bg-red-50 px-5 py-4">
      <h3 className="text-sm font-bold text-red-700">⚠ Massen-Löschung erkannt</h3>
      <ul className="mt-2 space-y-1 text-xs text-red-700/90">
        {massIn && <li>Eingehend: {detail.inDeleteCount} Tombstones bei Pool-Größe {detail.inPoolSize}</li>}
        {massOut && <li>Ausgehend: {detail.outDeleteCount} Tombstones bei Pool-Größe {detail.outPoolSize}</li>}
      </ul>
      <p className="mt-2 text-xs text-red-700/80">
        Bevor du fortfährst: prüfe ob das wirklich gewollt ist. Eine Pflegeaktion auf der Peer-Seite kann diesen Effekt erzeugen.
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-red-800">
        <input type="checkbox" checked={acknowledged} onChange={onAcknowledge} />
        Ich habe die Mass-Delete-Warnung gelesen und akzeptiere sie.
      </label>
    </div>
  )
}

function ConflictRow({
  conflict,
  resolution,
  onResolve,
}: {
  conflict: DiffConflict
  resolution: Resolution | undefined
  onResolve: (r: Resolution) => void
}) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] uppercase text-amber-900">conflict</span>
        <span className="font-mono text-xs text-primary-900">{conflict.path}</span>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
        <ConflictBtn checked={resolution === 'local'} onClick={() => onResolve('local')}>Lokal behalten</ConflictBtn>
        <ConflictBtn checked={resolution === 'remote'} onClick={() => onResolve('remote')}>Remote übernehmen</ConflictBtn>
        <ConflictBtn checked={resolution === 'manual'} onClick={() => onResolve('manual')} disabled>Manuell (TBD)</ConflictBtn>
      </div>
    </div>
  )
}

function ConflictBtn({
  checked,
  onClick,
  disabled,
  children,
}: {
  checked: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'rounded-md border px-2 py-1.5 text-xs '
        + (checked
          ? 'border-accent-500 bg-accent-500/10 text-primary-900'
          : 'border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50')
      }
    >
      {children}
    </button>
  )
}

function ItemTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-primary-200">
      <table className="w-full text-xs">
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function ItemRow({
  kind,
  op,
  path,
  checked,
  onToggle,
  readOnly,
}: {
  kind: 'memory' | 'skill' | 'session-snapshot'
  op: 'add' | 'update' | 'delete'
  path: string
  checked?: boolean
  onToggle?: () => void
  readOnly?: boolean
}) {
  return (
    <tr className="border-b border-primary-200 last:border-b-0">
      <td className="px-2 py-1.5 w-8">
        {!readOnly && (
          <input type="checkbox" checked={!!checked} onChange={onToggle} />
        )}
      </td>
      <td className="px-2 py-1.5 w-16"><OpBadge op={op} /></td>
      <td className="px-2 py-1.5 w-20 text-primary-500">{kind}</td>
      <td className="px-2 py-1.5 font-mono text-primary-900">{path}</td>
    </tr>
  )
}

function OpBadge({ op }: { op: 'add' | 'update' | 'delete' }) {
  const cls = op === 'add'
    ? 'bg-green-100 text-green-800'
    : op === 'delete'
      ? 'bg-red-100 text-red-800'
      : 'bg-blue-100 text-blue-800'
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase ${cls}`}>{op}</span>
}

function Section({
  title,
  hint,
  count,
  children,
}: {
  title: string
  hint?: string
  count: number | null
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-primary-700">{title}</h4>
        {count !== null && <span className="text-xs text-primary-500">({count} ausgewählt)</span>}
      </div>
      {hint && <p className="mb-2 text-xs text-primary-500">{hint}</p>}
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-primary-200 px-4 py-3 text-center text-xs text-primary-500">{children}</div>
}

function Steps({ step }: { step: Step }) {
  const idx = step === 'connect' ? 0 : step === 'diff' ? 1 : 2
  return (
    <div className="mb-4 flex gap-1">
      {[0, 1, 2].map((s) => (
        <div key={s} className={'h-1 flex-1 rounded ' + (s <= idx ? 'bg-accent-500' : 'bg-primary-200')} />
      ))}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-primary-50 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-primary-900">{title}</h3>
        {children}
      </div>
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">{children}</div>
}
