import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  AuthError,
  acceptInvite,
  changePassword,
  fetchInviteInfo,
  fetchSetupStatus,
  loginWithEmailPassword,
  performSetup,
  isValidSlug,
  suggestSlug,
} from '@/lib/workspace-auth'
import type { InviteInfo, SetupStatus } from '@/lib/workspace-auth'

type Mode =
  | { kind: 'loading' }
  | { kind: 'inconsistent'; hint: string }
  | { kind: 'setup' }
  | { kind: 'multi-tenant' }
  | { kind: 'multi-tenant-must-change-password' }
  | { kind: 'legacy' }
  | { kind: 'invite'; token: string }

/**
 * Routing surface for unauthenticated state.
 *
 * Reads `/api/setup-status` once on mount and renders one of:
 *
 *   - SetupWizard         when the stack is fresh (no users, no marker)
 *   - LoginForm           when multi-tenant migration is done
 *   - LegacyLoginForm     when running pre-migration (single password)
 *   - InconsistentBanner  when the boot-state-check refused to start
 *
 * Plus the InviteAcceptForm overlay if `/invite/<token>` is in the URL.
 */
export function LoginScreen() {
  const [mode, setMode] = useState<Mode>({ kind: 'loading' })

  useEffect(() => {
    // Detect /invite/<token> in the URL — public path, takes priority.
    if (typeof window !== 'undefined') {
      const m = /^\/invite\/([a-zA-Z0-9_-]+)/.exec(window.location.pathname)
      if (m) {
        setMode({ kind: 'invite', token: m[1] })
        return
      }
    }
    void fetchSetupStatus()
      .then((status) => setMode(modeFromStatus(status)))
      .catch(() => setMode({ kind: 'multi-tenant' })) // fail-safe to login
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="w-full max-w-md">
        {mode.kind === 'loading' && <LoadingCard />}
        {mode.kind === 'inconsistent' && <InconsistentBanner hint={mode.hint} />}
        {mode.kind === 'setup' && <SetupWizard />}
        {mode.kind === 'multi-tenant' && (
          <LoginForm
            onMustChangePassword={() =>
              setMode({ kind: 'multi-tenant-must-change-password' })
            }
          />
        )}
        {mode.kind === 'multi-tenant-must-change-password' && <ForceChangePasswordForm />}
        {mode.kind === 'legacy' && <LegacyLoginForm />}
        {mode.kind === 'invite' && <InviteAcceptForm token={mode.token} />}

        <Footer />
      </div>
    </div>
  )
}

function modeFromStatus(status: SetupStatus): Mode {
  if (status.mode === 'fresh-stack') return { kind: 'setup' }
  if (status.mode === 'multi-tenant') return { kind: 'multi-tenant' }
  if (status.mode === 'inconsistent') return { kind: 'inconsistent', hint: status.hint }
  return { kind: 'legacy' }
}

// ─── Sub-components ────────────────────────────────────────────────────

function HeaderLogo() {
  return (
    <div className="mb-8 flex justify-center">
      <div className="flex items-center gap-2.5">
        <svg
          width="32"
          height="32"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-accent-500"
        >
          <path
            d="M50 10 L90 30 L90 70 L50 90 L10 70 L10 30 Z"
            fill="currentColor"
            opacity="0.15"
          />
          <path
            d="M50 25 L75 38 L75 62 L50 75 L25 62 L25 38 Z"
            fill="currentColor"
            opacity="0.3"
          />
          <circle cx="50" cy="50" r="15" fill="currentColor" />
        </svg>
        <h1 className="text-2xl font-bold tracking-tight text-primary-900">
          Hermes Workspace
        </h1>
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-primary-100 px-8 py-10 shadow-xl shadow-primary-900/5 ring-1 ring-primary-200">
      <HeaderLogo />
      {children}
    </div>
  )
}

function Footer() {
  return (
    <p className="mt-6 text-center text-xs text-primary-500">
      Powered by{' '}
      <a
        href="https://github.com/NousResearch/hermes-agent"
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent-500 hover:text-accent-600 transition-colors"
      >
        Hermes Agent
      </a>
    </p>
  )
}

function LoadingCard() {
  return (
    <Card>
      <div className="flex justify-center py-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" />
      </div>
    </Card>
  )
}

function InconsistentBanner({ hint }: { hint: string }) {
  return (
    <Card>
      <h2 className="mb-2 text-center text-lg font-semibold text-red-700">
        Stack-Status inkohärent
      </h2>
      <p className="mb-4 text-center text-sm text-primary-700">
        Boot wurde blockiert weil der Migration-Marker fehlt aber Users existieren.
      </p>
      <pre className="overflow-x-auto rounded-lg bg-primary-200 px-4 py-3 text-xs text-primary-900">
        {hint}
      </pre>
    </Card>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-800/60">
      {message}
    </div>
  )
}

function PrimaryButton({
  children,
  loading,
  disabled,
  type = 'submit',
}: {
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
  type?: 'submit' | 'button'
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className="w-full rounded-lg bg-accent-500 px-4 py-2.5 font-medium text-white transition-all hover:bg-accent-600 focus:outline-none focus:ring-2 focus:ring-accent-500/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? '...' : children}
    </button>
  )
}

function TextField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoComplete?: string
  autoFocus?: boolean
  disabled?: boolean
  hint?: string
  error?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-primary-700">
        {props.label}
      </label>
      <input
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        className="w-full rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-primary-900 placeholder-primary-400 outline-none transition-all focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {props.hint && !props.error && (
        <p className="mt-1 text-xs text-primary-500">{props.hint}</p>
      )}
      {props.error && (
        <p className="mt-1 text-xs text-red-600">{props.error}</p>
      )}
    </div>
  )
}

// ─── Login (multi-tenant) ──────────────────────────────────────────────

function LoginForm({
  onMustChangePassword,
}: {
  onMustChangePassword: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await loginWithEmailPassword(email, password)
      // Successful login — refetch /me to detect mustChangePassword.
      const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' })
      const me = (await meRes.json()) as { user?: { mustChangePassword?: boolean } }
      if (me.user?.mustChangePassword) {
        onMustChangePassword()
        return
      }
      window.location.reload()
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.kind === 'locked') setError('Konto gesperrt — nach 15 Min wieder versuchen.')
        else if (err.kind === 'rate-limited') setError('Zu viele Versuche. Bitte warten.')
        else if (err.kind === 'mode-mismatch') {
          setError('Multi-Tenant-Auth ist nicht aktiv. Lade neu...')
          setTimeout(() => window.location.reload(), 1500)
        }
        else setError('Email oder Passwort falsch.')
      } else {
        setError('Login fehlgeschlagen.')
      }
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-center text-lg font-semibold text-primary-900">
        Anmelden
      </h2>
      <p className="mb-6 text-center text-sm text-primary-600">
        Mit deinem Hermes-Account einloggen
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          placeholder="phil@stratex-ai.com"
          autoComplete="email"
          autoFocus
          disabled={loading}
        />
        <TextField
          label="Passwort"
          value={password}
          onChange={setPassword}
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          disabled={loading}
        />
        {error && <ErrorBox message={error} />}
        <PrimaryButton loading={loading} disabled={!email || !password}>
          Einloggen
        </PrimaryButton>
      </form>
    </Card>
  )
}

// ─── Force-Change-Password (after Temp-PW login) ───────────────────────

function ForceChangePasswordForm() {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (newPw.length < 8) {
      setError('Neues Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (newPw !== confirmPw) {
      setError('Bestätigung stimmt nicht überein.')
      return
    }
    setLoading(true)
    try {
      await changePassword(oldPw, newPw)
      window.location.reload()
    } catch (err) {
      const msg = err instanceof AuthError && err.kind === 'invalid-credentials'
        ? 'Altes (Temp-)Passwort stimmt nicht.'
        : 'Passwort konnte nicht geändert werden.'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-center text-lg font-semibold text-primary-900">
        Passwort ändern
      </h2>
      <p className="mb-6 text-center text-sm text-primary-600">
        Du wurdest mit einem Temp-Passwort eingeloggt — bitte setze ein neues.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Aktuelles (Temp-)Passwort"
          value={oldPw}
          onChange={setOldPw}
          type="password"
          autoComplete="current-password"
          autoFocus
          disabled={loading}
        />
        <TextField
          label="Neues Passwort"
          value={newPw}
          onChange={setNewPw}
          type="password"
          autoComplete="new-password"
          hint="Mind. 8 Zeichen"
          disabled={loading}
        />
        <TextField
          label="Neues Passwort bestätigen"
          value={confirmPw}
          onChange={setConfirmPw}
          type="password"
          autoComplete="new-password"
          disabled={loading}
        />
        {error && <ErrorBox message={error} />}
        <PrimaryButton loading={loading} disabled={!oldPw || !newPw || !confirmPw}>
          Passwort speichern
        </PrimaryButton>
      </form>
    </Card>
  )
}

// ─── Legacy Login (single-PW, pre-migration) ──────────────────────────

function LegacyLoginForm() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (data.ok) window.location.reload()
      else {
        setError(data.error ?? 'Falsches Passwort')
        setLoading(false)
      }
    } catch {
      setError('Anmeldung fehlgeschlagen.')
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-center text-lg font-semibold text-primary-900">
        Workspace-Passwort
      </h2>
      <p className="mb-6 text-center text-sm text-primary-600">
        Legacy-Modus — Migration noch nicht gelaufen
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <TextField
          label="Passwort"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="current-password"
          autoFocus
          disabled={loading}
        />
        {error && <ErrorBox message={error} />}
        <PrimaryButton loading={loading} disabled={!password}>
          Weiter
        </PrimaryButton>
      </form>
    </Card>
  )
}

// ─── Setup Wizard (first-run-only) ─────────────────────────────────────

function SetupWizard() {
  const [step, setStep] = useState<1 | 2>(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Step 1 — Owner
  const [userId, setUserId] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')

  // Step 2 — Workspace
  const [wsId, setWsId] = useState('')
  const [wsName, setWsName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#5B6CFF')

  function next1(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!isValidSlug(userId)) {
      setError('User-ID darf nur a-z, 0-9, - enthalten.')
      return
    }
    if (!email.includes('@')) {
      setError('Email-Adresse fehlt @.')
      return
    }
    if (password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (password !== confirmPw) {
      setError('Bestätigung stimmt nicht überein.')
      return
    }
    setStep(2)
    setWsId(suggestSlug(name))
  }

  async function submit2(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!isValidSlug(wsId)) {
      setError('Workspace-ID darf nur a-z, 0-9, - enthalten.')
      return
    }
    if (wsName.trim().length === 0) {
      setError('Workspace-Name fehlt.')
      return
    }
    setLoading(true)
    try {
      await performSetup({
        user: { id: userId, email, name, password },
        workspace: { id: wsId, name: wsName, primaryColor },
      })
      window.location.assign('/')
    } catch (err) {
      const msg = err instanceof AuthError && err.kind === 'conflict'
        ? 'Setup wurde bereits abgeschlossen.'
        : err instanceof AuthError ? err.message : 'Setup fehlgeschlagen.'
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-center text-lg font-semibold text-primary-900">
        Willkommen — Setup
      </h2>
      <p className="mb-6 text-center text-sm text-primary-600">
        Schritt {step} von 2 — {step === 1 ? 'Owner-Account' : 'Erster Workspace'}
      </p>
      {step === 1 && (
        <form onSubmit={next1} className="space-y-4">
          <TextField
            label="User-ID (Slug)"
            value={userId}
            onChange={(v) => setUserId(v.toLowerCase())}
            placeholder="phil"
            autoFocus
            hint="a-z, 0-9, -; max 64 Zeichen"
          />
          <TextField
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            placeholder="phil@stratex-ai.com"
            autoComplete="email"
          />
          <TextField
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Phil Stratex"
            autoComplete="name"
          />
          <TextField
            label="Passwort"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="new-password"
            hint="Mind. 8 Zeichen"
          />
          <TextField
            label="Passwort bestätigen"
            value={confirmPw}
            onChange={setConfirmPw}
            type="password"
            autoComplete="new-password"
          />
          {error && <ErrorBox message={error} />}
          <PrimaryButton disabled={!userId || !email || !name || !password || !confirmPw}>
            Weiter
          </PrimaryButton>
        </form>
      )}
      {step === 2 && (
        <form onSubmit={submit2} className="space-y-4">
          <TextField
            label="Workspace-ID (Slug)"
            value={wsId}
            onChange={(v) => setWsId(v.toLowerCase())}
            placeholder="stratex"
            autoFocus
            hint="a-z, 0-9, -"
          />
          <TextField
            label="Workspace-Name"
            value={wsName}
            onChange={setWsName}
            placeholder="Stratex"
          />
          <div>
            <label className="mb-1 block text-xs font-medium text-primary-700">
              Workspace-Farbe
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-primary-200"
                disabled={loading}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900"
                pattern="^#[0-9a-fA-F]{6}$"
                disabled={loading}
              />
            </div>
          </div>
          {error && <ErrorBox message={error} />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={loading}
              className="flex-1 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 font-medium text-primary-700 transition-all hover:bg-primary-100 disabled:opacity-50"
            >
              Zurück
            </button>
            <PrimaryButton loading={loading} disabled={!wsId || !wsName}>
              Setup abschließen
            </PrimaryButton>
          </div>
        </form>
      )}
    </Card>
  )
}

// ─── Invite Accept ─────────────────────────────────────────────────────

function InviteAcceptForm({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [userId, setUserId] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    void fetchInviteInfo(token)
      .then(setInfo)
      .catch(() => setInfo({ ok: true, valid: false }))
  }, [token])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!isValidSlug(userId)) {
      setError('User-ID darf nur a-z, 0-9, - enthalten.')
      return
    }
    if (password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.')
      return
    }
    if (password !== confirmPw) {
      setError('Bestätigung stimmt nicht überein.')
      return
    }
    setLoading(true)
    try {
      await acceptInvite(token, { userId, name, password })
      window.location.assign('/')
    } catch (err) {
      const msg =
        err instanceof AuthError && err.kind === 'conflict'
          ? 'Diese User-ID ist bereits vergeben.'
          : err instanceof AuthError && err.kind === 'invite-invalid'
            ? 'Einladung ist abgelaufen oder bereits genutzt.'
            : err instanceof AuthError ? err.message : 'Beitritt fehlgeschlagen.'
      setError(msg)
      setLoading(false)
    }
  }

  if (!info) return <LoadingCard />
  if (!info.valid) {
    return (
      <Card>
        <h2 className="mb-2 text-center text-lg font-semibold text-red-700">
          Einladung ungültig
        </h2>
        <p className="text-center text-sm text-primary-700">
          Der Einladungs-Link ist abgelaufen, bereits genutzt oder unbekannt.
          Bitte den Admin um einen neuen Link bitten.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <div
        className="mb-4 h-2 w-full rounded-full"
        style={{ backgroundColor: info.workspace.branding.primaryColor }}
      />
      <h2 className="mb-2 text-center text-lg font-semibold text-primary-900">
        Beitritt zu „{info.workspace.name}"
      </h2>
      <p className="mb-6 text-center text-sm text-primary-600">
        Du wurdest als <strong>{info.role}</strong> eingeladen
        {info.email ? <> (für {info.email})</> : null}.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="User-ID (Slug)"
          value={userId}
          onChange={(v) => setUserId(v.toLowerCase())}
          placeholder="zb. partner-1"
          autoFocus
          hint="a-z, 0-9, -; max 64 Zeichen"
          disabled={loading}
        />
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Vorname Nachname"
          autoComplete="name"
          disabled={loading}
        />
        <TextField
          label="Passwort"
          value={password}
          onChange={setPassword}
          type="password"
          autoComplete="new-password"
          hint="Mind. 8 Zeichen"
          disabled={loading}
        />
        <TextField
          label="Passwort bestätigen"
          value={confirmPw}
          onChange={setConfirmPw}
          type="password"
          autoComplete="new-password"
          disabled={loading}
        />
        {error && <ErrorBox message={error} />}
        <PrimaryButton loading={loading} disabled={!userId || !name || !password || !confirmPw}>
          Beitreten
        </PrimaryButton>
      </form>
    </Card>
  )
}
