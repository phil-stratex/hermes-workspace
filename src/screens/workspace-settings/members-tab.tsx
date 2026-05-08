import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { isValidSlug } from '@/lib/workspace-auth'

type MemberRow = {
  userId: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
  addedBy: string
  email?: string
  name?: string
  status?: 'active' | 'disabled' | 'locked'
  failedLoginCount?: number
  lastLoginAt?: string
  lastFailedLoginAt?: string
}

type PendingInvite = {
  token: string
  email?: string
  role: 'admin' | 'member'
  createdAt: string
  expiresAt: string
  invitedBy: string
}

type MembersResponse = {
  ok: true
  members: Array<MemberRow>
  pendingInvites: Array<PendingInvite>
}

export function WorkspaceMembersTab() {
  const wsId = derivePathSegment('/workspace/', 1) ?? ''
  const [data, setData] = useState<MembersResponse | null>(null)
  const [error, setError] = useState('')
  const [activeModal, setActiveModal] = useState<
    | { kind: 'invite' }
    | { kind: 'invite-result'; inviteUrl: string; expiresAt: string }
    | { kind: 'remove'; member: MemberRow }
    | { kind: 'pw-reset-result'; tempPassword: string; userName: string }
    | null
  >(null)

  async function reload() {
    if (!wsId) return
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/members`, {
        credentials: 'same-origin',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden')
    }
  }

  useEffect(() => { void reload() }, [wsId])

  if (error) {
    return <Section title="Members"><ErrorBox>{error}</ErrorBox></Section>
  }
  if (!data) {
    return <Section title="Members"><Spinner /></Section>
  }

  return (
    <Section title="Members">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-primary-600">
          {data.members.length} Mitglied{data.members.length === 1 ? '' : 'er'}
        </p>
        <button
          type="button"
          onClick={() => setActiveModal({ kind: 'invite' })}
          className="rounded-lg bg-accent-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-600"
        >
          + Mitglied einladen
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-primary-200">
        <table className="w-full text-sm">
          <thead className="bg-primary-100 text-xs uppercase tracking-wide text-primary-600">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Rolle</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Letzter Login</th>
              <th className="px-3 py-2 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.userId} className="border-t border-primary-200">
                <td className="px-3 py-2 text-primary-900">
                  <div className="font-medium">{m.name ?? m.userId}</div>
                  <div className="text-xs text-primary-500">{m.userId}</div>
                </td>
                <td className="px-3 py-2 text-primary-700">{m.email ?? '—'}</td>
                <td className="px-3 py-2"><RoleBadge role={m.role} /></td>
                <td className="px-3 py-2"><StatusBadge member={m} /></td>
                <td className="px-3 py-2 text-xs text-primary-500">
                  {m.lastLoginAt ? formatDate(m.lastLoginAt) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {m.role !== 'owner' && (
                    <ActionMenu
                      member={m}
                      wsId={wsId}
                      onRoleChanged={reload}
                      onRemove={() => setActiveModal({ kind: 'remove', member: m })}
                      onPwReset={async () => {
                        try {
                          const res = await fetch(
                            `/api/users/${encodeURIComponent(m.userId)}/password-reset`,
                            { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                          )
                          const body = await res.json()
                          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
                          setActiveModal({
                            kind: 'pw-reset-result',
                            tempPassword: body.tempPassword,
                            userName: m.name ?? m.userId,
                          })
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'PW-Reset fehlgeschlagen')
                        }
                      }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.pendingInvites.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-primary-700">Pending Invites ({data.pendingInvites.length})</h3>
          <div className="overflow-hidden rounded-xl border border-primary-200">
            <table className="w-full text-sm">
              <thead className="bg-primary-100 text-xs uppercase tracking-wide text-primary-600">
                <tr>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Rolle</th>
                  <th className="px-3 py-2 text-left">Eingeladen von</th>
                  <th className="px-3 py-2 text-left">Verfällt</th>
                  <th className="px-3 py-2 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingInvites.map((i) => (
                  <tr key={i.token} className="border-t border-primary-200">
                    <td className="px-3 py-2 text-primary-700">{i.email ?? '—'}</td>
                    <td className="px-3 py-2"><RoleBadge role={i.role} /></td>
                    <td className="px-3 py-2 text-xs text-primary-500">{i.invitedBy}</td>
                    <td className="px-3 py-2 text-xs text-primary-500">{formatDate(i.expiresAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={async () => {
                          await fetch(
                            `/api/workspaces/${encodeURIComponent(wsId)}/invites/${encodeURIComponent(i.token)}`,
                            { method: 'DELETE', credentials: 'same-origin' },
                          )
                          await reload()
                        }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeModal?.kind === 'invite' && (
        <InviteCreateModal
          wsId={wsId}
          onClose={() => setActiveModal(null)}
          onCreated={(inviteUrl, expiresAt) => {
            setActiveModal({ kind: 'invite-result', inviteUrl, expiresAt })
            void reload()
          }}
        />
      )}
      {activeModal?.kind === 'invite-result' && (
        <InviteLinkModal
          inviteUrl={activeModal.inviteUrl}
          expiresAt={activeModal.expiresAt}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal?.kind === 'remove' && (
        <MemberRemoveModal
          wsId={wsId}
          member={activeModal.member}
          allMembers={data.members}
          onClose={() => setActiveModal(null)}
          onDone={() => {
            setActiveModal(null)
            void reload()
          }}
        />
      )}
      {activeModal?.kind === 'pw-reset-result' && (
        <PwResetResultModal
          tempPassword={activeModal.tempPassword}
          userName={activeModal.userName}
          onClose={() => setActiveModal(null)}
        />
      )}
    </Section>
  )
}

// ─── Modals ────────────────────────────────────────────────────────────

function InviteCreateModal({
  wsId,
  onClose,
  onCreated,
}: {
  wsId: string
  onClose: () => void
  onCreated: (inviteUrl: string, expiresAt: string) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [ttlDays, setTtlDays] = useState(7)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/invites`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, role, ttlDays }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      onCreated(
        `${window.location.origin}${body.invite.inviteUrl}`,
        body.invite.expiresAt,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Einladen fehlgeschlagen')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Mitglied einladen" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-primary-700">Email (optional)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="z. B. partner@stratex-ai.com"
            className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-primary-700">Rolle</label>
          <div className="flex gap-2">
            {(['member', 'admin'] as const).map((r) => (
              <label key={r} className={
                'flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm text-center '
                + (role === r ? 'border-accent-500 bg-accent-500/10 text-primary-900' : 'border-primary-200 bg-primary-50 text-primary-700')
              }>
                <input
                  type="radio"
                  className="sr-only"
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                {r === 'admin' ? 'Admin' : 'Member'}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-primary-700">Gültig (Tage)</label>
          <select
            value={ttlDays}
            onChange={(e) => setTtlDays(Number(e.target.value))}
            className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm"
          >
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm">
            Abbrechen
          </button>
          <button type="submit" disabled={submitting} className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {submitting ? '...' : 'Einladung erstellen'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function InviteLinkModal({
  inviteUrl,
  expiresAt,
  onClose,
}: {
  inviteUrl: string
  expiresAt: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <ModalShell title="Einladung erstellt" onClose={onClose}>
      <p className="mb-4 text-sm text-primary-700">
        Sende diesen Link an deinen Mitarbeiter:
      </p>
      <div className="mb-4 flex gap-2">
        <input
          readOnly
          type="text"
          value={inviteUrl}
          className="flex-1 rounded-lg border border-primary-200 bg-primary-100 px-3 py-2 text-sm text-primary-900"
        />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(inviteUrl)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white"
        >
          {copied ? '✓' : 'Kopieren'}
        </button>
      </div>
      <p className="text-xs text-primary-600">Gültig bis: {formatDate(expiresAt)}</p>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-primary-200 px-4 py-2 text-sm text-primary-800">
          Schließen
        </button>
      </div>
    </ModalShell>
  )
}

function PwResetResultModal({
  tempPassword,
  userName,
  onClose,
}: {
  tempPassword: string
  userName: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <ModalShell title="Temp-Passwort generiert" onClose={onClose}>
      <p className="mb-3 text-sm text-primary-700">
        Sende dieses Passwort an <strong>{userName}</strong>:
      </p>
      <div className="mb-4 flex gap-2">
        <input
          readOnly
          type="text"
          value={tempPassword}
          className="flex-1 rounded-lg border border-primary-200 bg-primary-100 px-3 py-2 font-mono text-sm text-primary-900"
        />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(tempPassword)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
          className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white"
        >
          {copied ? '✓' : 'Kopieren'}
        </button>
      </div>
      <ul className="space-y-1 text-xs text-amber-700">
        <li>⚠ Wird nur EINMAL angezeigt.</li>
        <li>⚠ User muss es beim nächsten Login ändern.</li>
        <li>⚠ Gültig 24h.</li>
      </ul>
      <div className="mt-6 flex justify-end">
        <button type="button" onClick={onClose} className="rounded-lg bg-primary-200 px-4 py-2 text-sm text-primary-800">
          Verstanden — Schließen
        </button>
      </div>
    </ModalShell>
  )
}

function MemberRemoveModal({
  wsId,
  member,
  allMembers,
  onClose,
  onDone,
}: {
  wsId: string
  member: MemberRow
  allMembers: ReadonlyArray<MemberRow>
  onClose: () => void
  onDone: () => void
}) {
  const [sessionsAction, setSessionsAction] = useState<'transfer' | 'delete' | 'none'>('none')
  const [transferTo, setTransferTo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const transferTargets = allMembers.filter((m) => m.userId !== member.userId)

  async function handleSubmit() {
    setError('')
    if (sessionsAction === 'transfer' && !isValidSlug(transferTo)) {
      setError('Bitte ein Übertragungs-Ziel auswählen.')
      return
    }
    setSubmitting(true)
    try {
      const params = new URLSearchParams()
      if (sessionsAction !== 'none') params.set('sessions', sessionsAction)
      if (sessionsAction === 'transfer') params.set('transferTo', transferTo)
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(member.userId)}?${params}`,
        { method: 'DELETE', credentials: 'same-origin' },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Entfernen fehlgeschlagen')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title={`„${member.name ?? member.userId}" entfernen`} onClose={onClose}>
      <p className="mb-4 text-sm text-primary-700">
        Was soll mit den Sessions des Members passieren?
      </p>
      <div className="space-y-2">
        <RadioOption
          checked={sessionsAction === 'none'}
          onChange={() => setSessionsAction('none')}
          label="Nur Membership entfernen"
          description="Sessions bleiben (für niemand sichtbar bis übertragen)."
        />
        <RadioOption
          checked={sessionsAction === 'transfer'}
          onChange={() => setSessionsAction('transfer')}
          label="Sessions an anderen User übertragen"
          description="Session-Owner wird umgesetzt."
        >
          {sessionsAction === 'transfer' && (
            <select
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              className="mt-2 w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm"
            >
              <option value="">— Wählen —</option>
              {transferTargets.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.userId} ({m.role})
                </option>
              ))}
            </select>
          )}
        </RadioOption>
        <RadioOption
          checked={sessionsAction === 'delete'}
          onChange={() => setSessionsAction('delete')}
          label="Sessions löschen"
          description="Permanente Löschung im Gateway. Nicht rückgängig."
        />
      </div>
      {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-sm">
          Abbrechen
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? '...' : 'Entfernen'}
        </button>
      </div>
    </ModalShell>
  )
}

// ─── Action Menu ───────────────────────────────────────────────────────

function ActionMenu({
  member,
  wsId,
  onRoleChanged,
  onRemove,
  onPwReset,
}: {
  member: MemberRow
  wsId: string
  onRoleChanged: () => void
  onRemove: () => void
  onPwReset: () => void
}) {
  const [open, setOpen] = useState(false)

  async function changeRole(newRole: 'admin' | 'member') {
    if (newRole === member.role) return
    await fetch(
      `/api/workspaces/${encodeURIComponent(wsId)}/members/${encodeURIComponent(member.userId)}`,
      {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      },
    )
    setOpen(false)
    onRoleChanged()
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-primary-500 hover:bg-primary-200"
        aria-label="Aktionen"
      >⋯</button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-primary-200 bg-primary-50 text-sm shadow-lg">
          {member.role !== 'admin' && (
            <button onClick={() => changeRole('admin')} className="block w-full px-3 py-2 text-left hover:bg-primary-100">
              Zu Admin promoten
            </button>
          )}
          {member.role !== 'member' && (
            <button onClick={() => changeRole('member')} className="block w-full px-3 py-2 text-left hover:bg-primary-100">
              Zu Member demoten
            </button>
          )}
          <button onClick={() => { setOpen(false); onPwReset() }} className="block w-full border-t border-primary-200 px-3 py-2 text-left hover:bg-primary-100">
            PW Reset (Temp)
          </button>
          <button onClick={() => { setOpen(false); onRemove() }} className="block w-full border-t border-primary-200 px-3 py-2 text-left text-red-600 hover:bg-red-50">
            Entfernen
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Layout helpers ────────────────────────────────────────────────────

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-primary-50 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-primary-900">{title}</h3>
        {children}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <h2 className="mb-6 text-lg font-semibold text-primary-900">{title}</h2>
      {children}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">{children}</div>
}

function Spinner() {
  return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" /></div>
}

function RoleBadge({ role }: { role: 'owner' | 'admin' | 'member' }) {
  const cls = role === 'owner'
    ? 'bg-purple-100 text-purple-800'
    : role === 'admin'
      ? 'bg-blue-100 text-blue-800'
      : 'bg-primary-200 text-primary-700'
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{role}</span>
}

function StatusBadge({ member }: { member: MemberRow }) {
  if (member.status === 'locked') return <span className="text-red-600 text-xs">⊘ locked</span>
  if (member.status === 'disabled') return <span className="text-primary-500 text-xs">○ disabled</span>
  if ((member.failedLoginCount ?? 0) > 0) return <span className="text-amber-600 text-xs" title={`${member.failedLoginCount} fehlgeschlagene Logins`}>◐ aktiv</span>
  return <span className="text-green-600 text-xs">● aktiv</span>
}

function RadioOption({
  checked,
  onChange,
  label,
  description,
  children,
}: {
  checked: boolean
  onChange: () => void
  label: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <label className={`block cursor-pointer rounded-lg border px-3 py-2 ${checked ? 'border-accent-500 bg-accent-500/5' : 'border-primary-200 bg-primary-50'}`}>
      <div className="flex items-center gap-2">
        <input type="radio" checked={checked} onChange={onChange} className="text-accent-500" />
        <div className="flex-1">
          <div className="text-sm text-primary-900">{label}</div>
          <div className="text-xs text-primary-600">{description}</div>
        </div>
      </div>
      {children}
    </label>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function derivePathSegment(prefix: string, idx: number): string | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname
  if (!path.startsWith(prefix)) return null
  const parts = path.slice(prefix.length).split('/')
  return parts[idx] ?? null
}
