import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  AuthError,
  changePassword,
  fetchCurrentUser,
} from '@/lib/workspace-auth'
import type { CurrentUser, MeResponse } from '@/lib/workspace-auth'

/**
 * /account — eigenes Profil + Password-Change. Die User-ID/Email/Name
 * sind read-only in Phase A.7 (Edit folgt im UI-Pflegeschritt nach
 * dem Existing-Routes-Refactor).
 */
export function AccountScreen() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    void fetchCurrentUser()
      .then((res) => {
        if (res && 'mode' in res && res.mode === 'multi-tenant') {
          setUser((res as MeResponse).user)
        } else {
          setLoadError('Multi-Tenant-Auth nicht aktiv.')
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Fehler'))
  }, [])

  if (loadError) {
    return <Shell><ErrorBox>{loadError}</ErrorBox></Shell>
  }
  if (!user) return <Shell><Spinner /></Shell>

  return (
    <Shell>
      <h1 className="mb-6 text-xl font-semibold text-primary-900">Mein Account</h1>

      <Section title="Profil">
        <Field label="User-ID">
          <input readOnly value={user.id} className={readonlyCls} />
        </Field>
        <Field label="Email">
          <input readOnly value={user.email} className={readonlyCls} />
        </Field>
        <Field label="Name">
          <input readOnly value={user.name} className={readonlyCls} />
        </Field>
        <Field label="Status">
          <input readOnly value={user.status} className={readonlyCls} />
        </Field>
        {user.lastLoginAt && (
          <Field label="Letzter Login">
            <input readOnly value={formatDate(user.lastLoginAt)} className={readonlyCls} />
          </Field>
        )}
      </Section>

      <Section title="Passwort ändern">
        <ChangePasswordForm />
      </Section>
    </Shell>
  )
}

function ChangePasswordForm() {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (newPw.length < 8) {
      setMsg({ kind: 'err', text: 'Mindestens 8 Zeichen.' })
      return
    }
    if (newPw !== confirmPw) {
      setMsg({ kind: 'err', text: 'Bestätigung stimmt nicht überein.' })
      return
    }
    setBusy(true)
    try {
      await changePassword(oldPw, newPw)
      setMsg({ kind: 'ok', text: 'Passwort geändert. Du wirst gleich neu eingeloggt …' })
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      const text = err instanceof AuthError && err.kind === 'invalid-credentials'
        ? 'Aktuelles Passwort stimmt nicht.'
        : 'Passwort konnte nicht geändert werden.'
      setMsg({ kind: 'err', text })
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Aktuelles Passwort">
        <input
          type="password"
          value={oldPw}
          onChange={(e) => setOldPw(e.target.value)}
          autoComplete="current-password"
          className={inputCls}
          disabled={busy}
        />
      </Field>
      <Field label="Neues Passwort" hint="Mindestens 8 Zeichen">
        <input
          type="password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          autoComplete="new-password"
          className={inputCls}
          disabled={busy}
        />
      </Field>
      <Field label="Neues Passwort bestätigen">
        <input
          type="password"
          value={confirmPw}
          onChange={(e) => setConfirmPw(e.target.value)}
          autoComplete="new-password"
          className={inputCls}
          disabled={busy}
        />
      </Field>
      {msg && (
        <div
          className={
            msg.kind === 'ok'
              ? 'rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 ring-1 ring-green-200'
              : 'rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200'
          }
        >
          {msg.text}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !oldPw || !newPw || !confirmPw}
        className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
      >
        Passwort speichern
      </button>
    </form>
  )
}

// ─── Layout helpers ────────────────────────────────────────────────────

const inputCls
  = 'w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:opacity-50'
const readonlyCls
  = 'w-full rounded-lg border border-primary-200 bg-primary-100 px-3 py-2 text-sm text-primary-600'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">{children}</div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-base font-semibold text-primary-900">{title}</h2>
      <div className="space-y-4 rounded-xl border border-primary-200 bg-primary-50 p-5">
        {children}
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
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

function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">{children}</div>
}

function Spinner() {
  return <div className="flex justify-center py-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" /></div>
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}
