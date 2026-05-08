import { useState } from 'react'
import type { FormEvent } from 'react'

import { isValidSlug } from '@/lib/workspace-auth'

type Step = 1 | 2 | 3 | 4

const SYNCED_TYPES = [
  { id: 'memories', label: 'Memories', desc: 'Markdown-Notes (memories/, MEMORY.md)' },
  { id: 'skills', label: 'Skills', desc: 'SKILL.md pro Skill' },
  { id: 'sessions-shared', label: 'Shared Sessions', desc: 'Nur explizit geteilte Snapshots — nie user-private' },
  { id: 'council', label: 'Council History', desc: 'Multi-LLM-Sessions' },
  { id: 'audit', label: 'Audit Log', desc: 'Cross-Verification' },
  { id: 'roster', label: 'Roster', desc: 'swarm.yaml — Default OFF' },
] as const

/**
 * 4-step wizard for `POST /api/workspaces/<wsId>/federation/peers`.
 *
 * Step 1: Name + Host + SSH-User + Port + Container-Name
 * Step 2: Generate SSH keypair, show public key + authorized_keys
 *         line for the operator to paste on the peer's VPS
 * Step 3: (operator) test connection and report
 * Step 4: Pick remote workspace id + synced types, persist peer
 *
 * Plan-Finding F4 — the wizard tells the operator the EXACT
 * `command="..."`-restricted line, so an unrestricted shell key never
 * gets installed even if the operator copies the line by hand.
 */
export function AddPeerWizard({
  wsId,
  onClose,
  onCreated,
}: {
  wsId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [sshUser, setSshUser] = useState('root')
  const [sshPort, setSshPort] = useState(22)
  const [containerName, setContainerName] = useState('hermes-workspace')

  // Step 4
  const [remoteWorkspaceId, setRemoteWorkspaceId] = useState('')
  const [syncedTypes, setSyncedTypes] = useState<Array<string>>(['memories', 'skills'])
  const [notes, setNotes] = useState('')

  // After-create state from the API
  const [createdState, setCreatedState] = useState<
    | null
    | {
        peerId: string
        publicKey: string
        authorizedKeysLine: string
      }
  >(null)

  function next1(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (name.trim().length === 0) { setError('Name fehlt.'); return }
    if (host.trim().length === 0) { setError('Host fehlt.'); return }
    if (sshUser.trim().length === 0) { setError('SSH-User fehlt.'); return }
    setStep(2)
  }

  async function submit4(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!isValidSlug(remoteWorkspaceId)) { setError('Remote-Workspace-ID muss ein Slug sein (a-z, 0-9, -).'); return }
    if (syncedTypes.length === 0) { setError('Mindestens einen Sync-Typ wählen.'); return }
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/federation/peers`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name, host, sshUser, sshPort,
            remoteWorkspaceId,
            syncedTypes,
            notes: notes.trim().length > 0 ? notes : undefined,
            containerName,
          }),
        },
      )
      const body = await res.json() as {
        ok: boolean
        peer?: { id: string }
        publicKey?: string
        authorizedKeysLine?: string
        error?: string
      }
      if (!res.ok || !body.peer || !body.publicKey || !body.authorizedKeysLine) {
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setCreatedState({
        peerId: body.peer.id,
        publicKey: body.publicKey,
        authorizedKeysLine: body.authorizedKeysLine,
      })
      setStep(3) // jump back to "show key + line"
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title={`Peer hinzufügen — Schritt ${step} von 4`} onClose={onClose}>
      <Steps step={step} />

      {step === 1 && (
        <form onSubmit={next1} className="space-y-3">
          <Field label="Anzeigename"><Input value={name} onChange={setName} placeholder="Lab Stack" autoFocus /></Field>
          <Field label="Host (IP oder DNS)"><Input value={host} onChange={setHost} placeholder="198.51.100.42" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SSH-User"><Input value={sshUser} onChange={setSshUser} /></Field>
            <Field label="SSH-Port">
              <input
                type="number" min={1} max={65535}
                value={sshPort}
                onChange={(e) => setSshPort(Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Container-Name auf Peer" hint="Name des Workspace-Containers im docker compose des Peer-Stacks (z. B. hermes-agent-zjya-hermes-workspace-1)">
            <Input value={containerName} onChange={setContainerName} />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Buttons onClose={onClose} primaryLabel="Weiter →" />
        </form>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-primary-700">
            Im nächsten Schritt erzeugen wir ein eigenes <strong>ed25519</strong>-Keypair für diesen Peer und zeigen dir die genaue Zeile,
            die der Peer-Admin auf seinem VPS in <code>~/.ssh/authorized_keys</code> einfügen muss. Die Zeile enthält eine
            <code className="rounded bg-primary-200 px-1">command="…"</code>-Restriction, die den Schlüssel auf den Federation-MCP-Server beschränkt — kein interaktiver Shell-Zugriff möglich.
          </p>
          <p className="text-xs text-primary-600">
            Wichtig: der Peer-Admin muss <strong>nur die unten gezeigte Zeile</strong> übernehmen, nicht den nackten Public-Key. Sonst hat er einen unbeschränkten Login-Key auf dem Peer-VPS.
          </p>
          <Buttons onClose={onClose} onBack={() => setStep(1)} primaryLabel="Keypair erzeugen →" onPrimary={() => setStep(4)} />
        </div>
      )}

      {step === 4 && !createdState && (
        <form onSubmit={submit4} className="space-y-3">
          <Field label="Remote-Workspace-ID" hint="Slug des Workspace im Peer-Stack — muss matchen, sonst weigert sich der Peer-MCP-Server">
            <Input value={remoteWorkspaceId} onChange={(v) => setRemoteWorkspaceId(v.toLowerCase())} placeholder="stratex" />
          </Field>
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-primary-700">Sync-Typen</div>
            <div className="space-y-1.5">
              {SYNCED_TYPES.map((t) => {
                const checked = syncedTypes.includes(t.id)
                return (
                  <label key={t.id} className={
                    'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 '
                    + (checked ? 'border-accent-500 bg-accent-500/5' : 'border-primary-200 bg-primary-50')
                  }>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSyncedTypes((prev) => prev.includes(t.id)
                          ? prev.filter((x) => x !== t.id)
                          : [...prev, t.id])
                      }}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm text-primary-900">{t.label}</div>
                      <div className="text-xs text-primary-600">{t.desc}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
          <Field label="Notizen (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
            />
          </Field>
          {error && <ErrorBox>{error}</ErrorBox>}
          <Buttons onClose={onClose} onBack={() => setStep(2)} primaryLabel={submitting ? 'Wird erstellt …' : 'Peer anlegen + Keypair generieren'} primaryDisabled={submitting} />
        </form>
      )}

      {step === 3 && createdState && (
        <KeypairResultStep state={createdState} onDone={onCreated} />
      )}
    </ModalShell>
  )
}

function KeypairResultStep({
  state,
  onDone,
}: {
  state: { peerId: string; publicKey: string; authorizedKeysLine: string }
  onDone: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-3">
      <p className="text-sm text-primary-700">
        Peer angelegt. Sende dem Peer-Admin <strong>diese exakte Zeile</strong> — er fügt sie in <code>~/.ssh/authorized_keys</code> auf seinem VPS ein:
      </p>
      <div className="rounded-lg border border-primary-200 bg-primary-100 px-3 py-3 font-mono text-xs text-primary-900 break-all">
        {state.authorizedKeysLine}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(state.authorizedKeysLine)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600"
        >
          {copied ? '✓ Kopiert' : '📋 Zeile kopieren'}
        </button>
      </div>
      <p className="text-xs text-primary-600">
        Der Public-Key wurde lokal gespeichert. Sobald der Peer-Admin die Zeile installiert hat, kannst du in der Peer-Liste auf <strong>Verbinden</strong> klicken — wir probieren dann automatisch ob die <code>command="…"</code>-Restriction wirklich greift.
      </p>
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white"
        >
          Fertig
        </button>
      </div>
    </div>
  )
}

// ─── Layout ─────────────────────────────────────────────────────────

function Steps({ step }: { step: Step }) {
  return (
    <div className="mb-4 flex gap-1">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className={
            'h-1 flex-1 rounded '
            + (s <= step ? 'bg-accent-500' : 'bg-primary-200')
          }
        />
      ))}
    </div>
  )
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-primary-50 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-primary-900">{title}</h3>
        {children}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-primary-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-primary-500">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20'

function Input({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={inputCls}
    />
  )
}

function Buttons({
  onClose,
  onBack,
  onPrimary,
  primaryLabel,
  primaryDisabled,
}: {
  onClose: () => void
  onBack?: () => void
  onPrimary?: () => void
  primaryLabel: string
  primaryDisabled?: boolean
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button type="button" onClick={onClose} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm">
        Abbrechen
      </button>
      {onBack && (
        <button type="button" onClick={onBack} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm">
          ← Zurück
        </button>
      )}
      <button
        type={onPrimary ? 'button' : 'submit'}
        onClick={onPrimary}
        disabled={primaryDisabled}
        className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
      >
        {primaryLabel}
      </button>
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">{children}</div>
}
