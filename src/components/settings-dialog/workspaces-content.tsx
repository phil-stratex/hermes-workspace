'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Building01Icon,
  Cancel01Icon,
  Crown02Icon,
  Delete02Icon,
  PlusSignIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import {
  AuthError,
  createWorkspace,
  deleteWorkspace,
  fetchCurrentUser,
  inviteMember,
  isValidSlug,
  listMembers,
  removeMember,
  revokeInvite,
  setMemberRole,
  suggestSlug,
  updateWorkspace,
} from '@/lib/workspace-auth'
import type {
  MeResponse,
  Membership,
  MembersResponse,
  MemberRow,
  PendingInvite,
} from '@/lib/workspace-auth'

const CARD_CLASS =
  'rounded-xl border border-primary-200 dark:border-neutral-700 bg-primary-50/80 dark:bg-neutral-800/60 px-4 py-3 shadow-sm'

type ViewState =
  | { kind: 'list'; createOpen: boolean }
  | { kind: 'detail'; wsId: string }

type Props = {
  initialAction?: 'create-workspace'
  /** Used by the parent to clear initialAction after consumption. */
  onConsumeInitialAction?: () => void
}

export function WorkspacesContent({ initialAction, onConsumeInitialAction }: Props = {}) {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [view, setView] = useState<ViewState>({
    kind: 'list',
    createOpen: initialAction === 'create-workspace',
  })

  useEffect(() => {
    if (initialAction === 'create-workspace') {
      onConsumeInitialAction?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAction])

  useEffect(() => {
    let cancelled = false
    void fetchCurrentUser().then((res) => {
      if (cancelled) return
      if (res && 'mode' in res && res.mode === 'multi-tenant') {
        setMe(res as MeResponse)
        setError(null)
      } else {
        setMe(null)
        setError('Multi-Tenant-Auth nicht aktiv. Workspace-Verwaltung steht nicht zur Verfügung.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [refreshTick])

  function reload() {
    setRefreshTick((t) => t + 1)
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Header
          title="Workspaces"
          description="Verwalte deine Workspaces und Mitglieder."
        />
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-700/40">
          {error}
        </div>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="space-y-4">
        <Header
          title="Workspaces"
          description="Verwalte deine Workspaces und Mitglieder."
        />
        <Spinner />
      </div>
    )
  }

  if (view.kind === 'detail') {
    return (
      <DetailView
        wsId={view.wsId}
        me={me}
        onBack={() => setView({ kind: 'list', createOpen: false })}
        onChanged={reload}
      />
    )
  }

  return (
    <ListView
      me={me}
      createOpen={view.createOpen}
      onSetCreateOpen={(open) => setView({ kind: 'list', createOpen: open })}
      onOpenDetail={(wsId) => setView({ kind: 'detail', wsId })}
      onChanged={reload}
    />
  )
}

// ── List ──────────────────────────────────────────────────────────────

function ListView({
  me,
  createOpen,
  onSetCreateOpen,
  onOpenDetail,
  onChanged,
}: {
  me: MeResponse
  createOpen: boolean
  onSetCreateOpen: (open: boolean) => void
  onOpenDetail: (wsId: string) => void
  onChanged: () => void
}) {
  return (
    <div className="space-y-4">
      <Header
        title="Workspaces"
        description="Erstelle, verwalte oder verlasse Workspaces. Backend ist Multi-Tenant — jeder Workspace ist eine eigene Daten-Sandbox."
      />

      <div className="space-y-2">
        {me.memberships.map((m) => (
          <WorkspaceListRow
            key={m.workspaceId}
            membership={m}
            isActive={m.workspaceId === me.activeWorkspaceId}
            onOpen={() => onOpenDetail(m.workspaceId)}
            onDeleted={onChanged}
          />
        ))}
      </div>

      {createOpen ? (
        <CreateWorkspaceForm
          onCancel={() => onSetCreateOpen(false)}
          onCreated={(wsId) => {
            onSetCreateOpen(false)
            onChanged()
            onOpenDetail(wsId)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => onSetCreateOpen(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-300 dark:border-neutral-700 bg-primary-50/40 dark:bg-neutral-800/40 px-4 py-3 text-sm font-medium text-primary-700 dark:text-neutral-200 transition-colors hover:bg-primary-100 dark:hover:bg-neutral-800"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={1.5} />
          Neuer Workspace
        </button>
      )}
    </div>
  )
}

function WorkspaceListRow({
  membership,
  isActive,
  onOpen,
  onDeleted,
}: {
  membership: Membership
  isActive: boolean
  onOpen: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isOwner = membership.role === 'owner'

  async function handleDelete() {
    if (confirmText !== membership.workspaceId) return
    setBusy(true)
    setErr(null)
    try {
      await deleteWorkspace(membership.workspaceId)
      setDeleting(false)
      setConfirmText('')
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center gap-3">
        <span
          className="h-9 w-1.5 shrink-0 rounded-sm"
          style={{ backgroundColor: membership.branding.primaryColor }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-primary-900 dark:text-neutral-100">
              {membership.name}
            </span>
            {isActive && (
              <span className="rounded-full bg-accent-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:text-accent-300">
                aktiv
              </span>
            )}
            <RoleBadge role={membership.role} />
          </div>
          <div className="truncate text-xs text-primary-500 dark:text-neutral-400">
            {membership.workspaceId}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onOpen}
            className="text-primary-700 dark:text-neutral-200"
          >
            <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.5} />
            Verwalten
          </Button>
          {isOwner && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setDeleting((d) => !d)}
              aria-label="Löschen"
              className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.5} />
            </Button>
          )}
        </div>
      </div>
      {deleting && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-700/40 dark:bg-red-900/20">
          <p className="mb-2 text-xs text-red-700 dark:text-red-200">
            Soft-Delete mit 30 Tagen Recovery. Alle Members verlieren sofort
            Zugang. Tippe <strong>{membership.workspaceId}</strong> zum
            Bestätigen.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={membership.workspaceId}
              className="flex-1 rounded-lg border border-red-200 bg-primary-50 dark:bg-neutral-900 px-3 py-1.5 text-sm text-primary-900 dark:text-neutral-100"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDeleting(false)
                setConfirmText('')
                setErr(null)
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleDelete}
              disabled={confirmText !== membership.workspaceId || busy}
              className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? '…' : 'Löschen'}
            </Button>
          </div>
          {err && (
            <p className="mt-2 text-xs text-red-700 dark:text-red-200">{err}</p>
          )}
        </div>
      )}
    </div>
  )
}

function CreateWorkspaceForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (wsId: string) => void
}) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#5B6CFF')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [idTouched, setIdTouched] = useState(false)

  function handleNameChange(value: string) {
    setName(value)
    if (!idTouched) setId(suggestSlug(value))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) {
      setErr('Name darf nicht leer sein.')
      return
    }
    if (!isValidSlug(id)) {
      setErr('Workspace-ID muss aus a–z, 0–9 und Bindestrichen bestehen.')
      return
    }
    setBusy(true)
    try {
      const res = await createWorkspace({ id, name: name.trim(), primaryColor })
      onCreated(res.workspace.id)
    } catch (e) {
      if (e instanceof AuthError && e.kind === 'conflict') {
        setErr('Eine Workspace-ID „' + id + '" existiert bereits.')
      } else {
        setErr(e instanceof Error ? e.message : 'Erstellen fehlgeschlagen')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={CARD_CLASS + ' space-y-3'}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-primary-900 dark:text-neutral-100">
          Neuen Workspace erstellen
        </div>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onCancel} aria-label="Abbrechen">
          <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
        </Button>
      </div>
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="z. B. Plan B"
          autoFocus
          className="w-full rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
      </Field>
      <Field label="Workspace-ID" hint="URL-Slug. Wird auto-generiert aus dem Namen, kann aber überschrieben werden.">
        <input
          type="text"
          value={id}
          onChange={(e) => {
            setId(e.target.value.toLowerCase())
            setIdTouched(true)
          }}
          placeholder="plan-b"
          className="w-full rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 font-mono text-sm text-primary-900 dark:text-neutral-100 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
      </Field>
      <Field label="Farbe">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-primary-200 dark:border-neutral-700"
          />
          <input
            type="text"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            pattern="^#[0-9a-fA-F]{6}$"
            className="flex-1 rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100"
          />
        </div>
      </Field>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !name.trim() || !isValidSlug(id)}
          className="bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
        >
          {busy ? '…' : 'Erstellen'}
        </Button>
      </div>
    </form>
  )
}

// ── Detail ────────────────────────────────────────────────────────────

function DetailView({
  wsId,
  me,
  onBack,
  onChanged,
}: {
  wsId: string
  me: MeResponse
  onBack: () => void
  onChanged: () => void
}) {
  const membership = me.memberships.find((m) => m.workspaceId === wsId)
  const [data, setData] = useState<MembersResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(null)
    listMembers(wsId)
      .then((res) => {
        if (cancelled) return
        setData(res)
      })
      .catch((e) => {
        if (cancelled) return
        if (e instanceof AuthError && e.status === 403) {
          setError('Du hast keine Berechtigung, Mitglieder dieses Workspaces zu sehen.')
        } else {
          setError(e instanceof Error ? e.message : 'Fehler beim Laden')
        }
      })
    return () => {
      cancelled = true
    }
  }, [wsId, tick])

  function reload() {
    setTick((t) => t + 1)
  }

  if (!membership) {
    return (
      <div className="space-y-3">
        <BackBar onBack={onBack} title="Unbekannter Workspace" subtitle={wsId} />
        <ErrorBox>Du bist nicht Mitglied dieses Workspaces.</ErrorBox>
      </div>
    )
  }

  const canManageMembers = membership.role === 'owner' || membership.role === 'admin'
  const canEditSettings = membership.role === 'owner' || membership.role === 'admin'
  const canDelete = membership.role === 'owner'

  return (
    <div className="space-y-4">
      <BackBar
        onBack={onBack}
        title={membership.name}
        subtitle={wsId}
        roleBadge={<RoleBadge role={membership.role} />}
      />

      {canEditSettings && (
        <GeneralSection wsId={wsId} onSaved={() => { reload(); onChanged() }} />
      )}

      <div className={CARD_CLASS}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-primary-900 dark:text-neutral-100">
              Mitglieder
            </div>
            <div className="text-xs text-primary-500 dark:text-neutral-400">
              {data ? `${data.members.length} aktive Mitglieder` : '…'}
            </div>
          </div>
        </div>
        {error ? (
          <ErrorBox>{error}</ErrorBox>
        ) : !data ? (
          <Spinner />
        ) : (
          <MembersList
            wsId={wsId}
            data={data}
            currentUserId={me.user.id}
            currentUserRole={membership.role}
            canManage={canManageMembers}
            onChanged={() => { reload(); onChanged() }}
          />
        )}
        {data && canManageMembers && (
          <InviteForm wsId={wsId} onCreated={reload} />
        )}
      </div>

      {canDelete && data && (
        <TransferWorkspaceCard
          wsId={wsId}
          allMembers={data.members}
          currentUserId={me.user.id}
          onDone={() => { reload(); onChanged() }}
        />
      )}

      {canDelete && (
        <DangerZone
          wsId={wsId}
          onDeleted={() => {
            onChanged()
            onBack()
          }}
        />
      )}
    </div>
  )
}

function GeneralSection({
  wsId,
  onSaved,
}: {
  wsId: string
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#5B6CFF')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/workspaces/${encodeURIComponent(wsId)}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: { workspace?: { name: string; description?: string; branding: { primaryColor: string } } }) => {
        if (cancelled) return
        if (d.workspace) {
          setName(d.workspace.name)
          setDescription(d.workspace.description ?? '')
          setPrimaryColor(d.workspace.branding.primaryColor)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [wsId])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await updateWorkspace(wsId, { name, description, primaryColor })
      setMsg({ kind: 'ok', text: 'Gespeichert.' })
      onSaved()
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Fehler' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={CARD_CLASS + ' space-y-3'}>
      <div className="text-sm font-medium text-primary-900 dark:text-neutral-100">
        Allgemein
      </div>
      <Field label="Name">
        <input
          type="text"
          value={name}
          disabled={!loaded}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
      </Field>
      <Field label="Beschreibung">
        <textarea
          value={description}
          rows={2}
          disabled={!loaded}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20"
        />
      </Field>
      <Field label="Farbe">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-primary-200 dark:border-neutral-700"
          />
          <input
            type="text"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            pattern="^#[0-9a-fA-F]{6}$"
            className="flex-1 rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100"
          />
        </div>
      </Field>
      {msg && (
        <div
          className={
            msg.kind === 'ok'
              ? 'rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700 ring-1 ring-green-200 dark:bg-green-900/30 dark:text-green-200 dark:ring-green-700/40'
              : 'rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-200 dark:ring-red-700/40'
          }
        >
          {msg.text}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          size="sm"
          disabled={busy || !loaded}
          className="bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
        >
          {busy ? '…' : 'Speichern'}
        </Button>
      </div>
    </form>
  )
}

function MembersList({
  wsId,
  data,
  currentUserId,
  currentUserRole,
  canManage,
  onChanged,
}: {
  wsId: string
  data: MembersResponse
  currentUserId: string
  currentUserRole: 'owner' | 'admin' | 'member'
  canManage: boolean
  onChanged: () => void
}) {
  const ownerCount = data.members.filter((m) => m.role === 'owner').length
  return (
    <div className="space-y-2">
      {data.members.map((m) => (
        <MemberItem
          key={m.userId}
          wsId={wsId}
          member={m}
          isSelf={m.userId === currentUserId}
          currentUserRole={currentUserRole}
          ownerCount={ownerCount}
          canManage={canManage}
          allMembers={data.members}
          onChanged={onChanged}
        />
      ))}
      {data.pendingInvites.length > 0 && (
        <div className="mt-2 border-t border-primary-200 dark:border-neutral-700 pt-2">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-primary-500 dark:text-neutral-400">
            Ausstehende Einladungen
          </div>
          {data.pendingInvites.map((i) => (
            <PendingInviteItem
              key={i.token}
              wsId={wsId}
              invite={i}
              canManage={canManage}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MemberItem({
  wsId,
  member,
  isSelf,
  currentUserRole,
  ownerCount,
  canManage,
  allMembers,
  onChanged,
}: {
  wsId: string
  member: MemberRow
  isSelf: boolean
  currentUserRole: 'owner' | 'admin' | 'member'
  ownerCount: number
  canManage: boolean
  allMembers: ReadonlyArray<MemberRow>
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [promoting, setPromoting] = useState(false)

  const callerIsOwner = currentUserRole === 'owner'
  const isLastOwner = member.role === 'owner' && ownerCount === 1
  const showManageColumn = canManage && !isSelf
  // Only Owner can promote to Owner; not Self (you're already higher or
  // can't promote yourself); not for an existing Owner.
  const canPromoteToOwner = callerIsOwner && member.role !== 'owner' && !isSelf
  // Self-demote is blocked here — explicit "Workspace übertragen" flow only.
  const selectDisabled = busy || isSelf || isLastOwner

  async function handleRoleChange(newRole: 'admin' | 'member' | 'owner') {
    if (newRole === member.role) return
    setBusy(true)
    setErr(null)
    try {
      await setMemberRole(wsId, member.userId, newRole)
      onChanged()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fehler'
      if (member.role === 'owner' && /last owner/i.test(msg)) {
        setErr('Letzten Owner kannst du nicht demoten — ernenne erst einen anderen Member zum Owner.')
      } else {
        setErr(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handlePromoteToOwner() {
    setBusy(true)
    setErr(null)
    try {
      await setMemberRole(wsId, member.userId, 'owner')
      setPromoting(false)
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Promotion fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50/40 dark:bg-neutral-900/40 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm text-primary-900 dark:text-neutral-100">
              {member.name ?? member.userId}
              {isSelf && (
                <span className="ml-1 text-xs text-primary-500 dark:text-neutral-400">
                  (du)
                </span>
              )}
            </span>
            <RoleBadge role={member.role} />
          </div>
          <div className="truncate text-xs text-primary-500 dark:text-neutral-400">
            {member.email ?? member.userId}
          </div>
        </div>
        {showManageColumn && (
          <div className="flex items-center gap-1.5">
            <select
              value={member.role}
              onChange={(e) => void handleRoleChange(e.target.value as 'admin' | 'member' | 'owner')}
              disabled={selectDisabled}
              title={
                isLastOwner
                  ? 'Letzten Owner kannst du nicht demoten — ernenne erst einen anderen Member zum Owner.'
                  : undefined
              }
              className="rounded-md border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-2 py-1 text-xs text-primary-900 dark:text-neutral-100 disabled:opacity-60"
            >
              {member.role === 'owner' && <option value="owner">Owner</option>}
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            {canPromoteToOwner && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => setPromoting((p) => !p)}
                aria-label="Zu Owner ernennen"
                title="Zu Owner ernennen"
                className="text-purple-700 hover:bg-purple-100 dark:text-purple-300 dark:hover:bg-purple-900/30"
              >
                <HugeiconsIcon icon={Crown02Icon} size={14} strokeWidth={1.5} />
              </Button>
            )}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setRemoving((r) => !r)}
              aria-label="Entfernen"
              className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.5} />
            </Button>
          </div>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {promoting && (
        <PromoteToOwnerPanel
          memberName={member.name ?? member.userId}
          onCancel={() => setPromoting(false)}
          onConfirm={handlePromoteToOwner}
          busy={busy}
        />
      )}
      {removing && (
        <RemoveMemberPanel
          wsId={wsId}
          member={member}
          allMembers={allMembers}
          onCancel={() => setRemoving(false)}
          onDone={() => {
            setRemoving(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function RemoveMemberPanel({
  wsId,
  member,
  allMembers,
  onCancel,
  onDone,
}: {
  wsId: string
  member: MemberRow
  allMembers: ReadonlyArray<MemberRow>
  onCancel: () => void
  onDone: () => void
}) {
  const [action, setAction] = useState<'none' | 'transfer' | 'delete'>('none')
  const [transferTo, setTransferTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const targets = allMembers.filter((m) => m.userId !== member.userId)

  async function handleSubmit() {
    setErr(null)
    if (action === 'transfer' && !transferTo) {
      setErr('Bitte wähle ein Übertragungs-Ziel.')
      return
    }
    setBusy(true)
    try {
      const sessionsAction =
        action === 'none'
          ? undefined
          : action === 'transfer'
            ? { action: 'transfer' as const, transferTo }
            : { action: 'delete' as const }
      await removeMember(wsId, member.userId, sessionsAction)
      onDone()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fehler')
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-700/40 dark:bg-red-900/20">
      <p className="text-xs text-red-700 dark:text-red-200">
        „{member.name ?? member.userId}" entfernen — was passiert mit den Sessions?
      </p>
      <div className="space-y-1">
        {(['none', 'transfer', 'delete'] as const).map((a) => (
          <label key={a} className="flex items-center gap-2 text-xs text-red-700 dark:text-red-200">
            <input
              type="radio"
              name={`session-action-${member.userId}`}
              value={a}
              checked={action === a}
              onChange={() => setAction(a)}
            />
            {a === 'none' && 'Nur Membership entfernen'}
            {a === 'transfer' && 'An anderen User übertragen'}
            {a === 'delete' && 'Sessions löschen (permanent)'}
          </label>
        ))}
        {action === 'transfer' && (
          <select
            value={transferTo}
            onChange={(e) => setTransferTo(e.target.value)}
            className="ml-5 mt-1 rounded-md border border-red-200 bg-primary-50 px-2 py-1 text-xs text-primary-900 dark:border-red-700/40 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <option value="">— Wählen —</option>
            {targets.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.userId} ({m.role})
              </option>
            ))}
          </select>
        )}
      </div>
      {err && <p className="text-xs text-red-700 dark:text-red-200">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={busy}
          className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Entfernen'}
        </Button>
      </div>
    </div>
  )
}

function PendingInviteItem({
  wsId,
  invite,
  canManage,
  onChanged,
}: {
  wsId: string
  invite: PendingInvite
  canManage: boolean
  onChanged: () => void
}) {
  const [revoking, setRevoking] = useState(false)

  async function handleRevoke() {
    setRevoking(true)
    try {
      await revokeInvite(wsId, invite.token)
      onChanged()
    } catch {
      setRevoking(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50/40 dark:bg-amber-900/15 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs text-primary-700 dark:text-neutral-200">
            {invite.email ?? '(offen — kein Email-Bezug)'}
          </span>
          <RoleBadge role={invite.role} />
        </div>
        <div className="text-[10px] text-primary-500 dark:text-neutral-400">
          gültig bis {formatDate(invite.expiresAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(
            `${window.location.origin}/invite/${invite.token}`,
          )
        }}
        className="text-xs text-primary-600 hover:underline dark:text-neutral-300"
      >
        Link kopieren
      </button>
      {canManage && (
        <button
          type="button"
          onClick={handleRevoke}
          disabled={revoking}
          className="text-xs text-red-600 hover:underline disabled:opacity-50"
        >
          Revoke
        </button>
      )}
    </div>
  )
}

function InviteForm({
  wsId,
  onCreated,
}: {
  wsId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [ttlDays, setTtlDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const res = await inviteMember(wsId, {
        email: email.trim() || undefined,
        role,
        ttlDays,
      })
      setResult({
        url: `${window.location.origin}${res.invite.inviteUrl}`,
        expiresAt: res.invite.expiresAt,
      })
      setEmail('')
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Einladen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 dark:border-green-700/40 dark:bg-green-900/20">
        <p className="mb-2 text-xs text-green-700 dark:text-green-200">
          Einladung erstellt — Link kopieren und an die Person senden:
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={result.url}
            className="flex-1 rounded-md border border-green-200 bg-primary-50 dark:bg-neutral-900 px-2 py-1 font-mono text-[11px] text-primary-900 dark:text-neutral-100"
          />
          <Button
            type="button"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(result.url)
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="bg-accent-500 text-white hover:bg-accent-600"
          >
            {copied ? '✓' : 'Kopieren'}
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-green-700 dark:text-green-200">
          <span>gültig bis {formatDate(result.expiresAt)}</span>
          <button type="button" onClick={() => setResult(null)} className="hover:underline">
            Weitere einladen
          </button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary-300 dark:border-neutral-700 px-3 py-2 text-xs font-medium text-primary-700 dark:text-neutral-200 hover:bg-primary-100 dark:hover:bg-neutral-800"
      >
        <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={1.5} />
        Mitglied einladen
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-lg border border-primary-200 dark:border-neutral-700 bg-primary-50/40 dark:bg-neutral-900/40 px-3 py-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@beispiel.com (optional)"
          className="col-span-1 rounded-md border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-2 py-1.5 text-xs text-primary-900 dark:text-neutral-100 sm:col-span-2"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
          className="rounded-md border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-2 py-1.5 text-xs text-primary-900 dark:text-neutral-100"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-primary-600 dark:text-neutral-400">
          gültig
        </label>
        <select
          value={ttlDays}
          onChange={(e) => setTtlDays(Number(e.target.value))}
          className="rounded-md border border-primary-200 dark:border-neutral-700 bg-primary-50 dark:bg-neutral-900 px-2 py-1 text-xs text-primary-900 dark:text-neutral-100"
        >
          {[1, 3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>{d} Tage</option>
          ))}
        </select>
      </div>
      {err && <ErrorBox>{err}</ErrorBox>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy}
          className="bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
        >
          {busy ? '…' : 'Einladen'}
        </Button>
      </div>
    </form>
  )
}

function PromoteToOwnerPanel({
  memberName,
  onCancel,
  onConfirm,
  busy,
}: {
  memberName: string
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}) {
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 dark:border-purple-700/40 dark:bg-purple-900/20">
      <p className="text-xs text-purple-800 dark:text-purple-200">
        <strong>{memberName}</strong> bekommt volle Owner-Rechte (kann den
        Workspace löschen, andere Owner ernennen, Members verwalten). Du
        behältst deine Owner-Rechte — der Workspace hat dann mehrere Owner.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onConfirm}
          disabled={busy}
          className="bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Zu Owner ernennen'}
        </Button>
      </div>
    </div>
  )
}

function TransferWorkspaceCard({
  wsId,
  allMembers,
  currentUserId,
  onDone,
}: {
  wsId: string
  allMembers: ReadonlyArray<MemberRow>
  currentUserId: string
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [recipientId, setRecipientId] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const targets = allMembers.filter((m) => m.userId !== currentUserId)

  async function handleSubmit() {
    setErr(null)
    if (!recipientId) {
      setErr('Bitte wähle einen Empfänger.')
      return
    }
    if (confirmText !== wsId) {
      setErr('Bestätigung passt nicht — tippe „' + wsId + '" exakt.')
      return
    }
    setBusy(true)
    try {
      // Step 1: promote recipient
      await setMemberRole(wsId, recipientId, 'owner')
      // Step 2: self-demote
      try {
        await setMemberRole(wsId, currentUserId, 'admin')
        setOpen(false)
        setRecipientId('')
        setConfirmText('')
        onDone()
      } catch (e) {
        setErr(
          'Empfänger wurde Owner — dein Self-Demote ist fehlgeschlagen ('
            + (e instanceof Error ? e.message : 'unbekannt')
            + '). Bitte erneut versuchen oder manuell zurücksetzen.',
        )
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Übertragung fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  if (targets.length === 0) {
    return null
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-700/40 dark:bg-amber-900/20">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Workspace übertragen
          </div>
          <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
            Gibt deine Owner-Rechte komplett an einen anderen Member ab. Du
            wirst danach Admin. Im Unterschied zu „Zu Owner ernennen" (Multi-
            Owner-additiv) ist das ein Transfer.
          </p>
        </div>
        {!open && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setOpen(true)}
            className="shrink-0 border border-amber-300 bg-primary-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-neutral-900 dark:text-amber-200 dark:hover:bg-amber-900/30"
          >
            Übertragen…
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <Field label="Empfänger">
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full rounded-lg border border-amber-200 dark:border-amber-700/40 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100"
            >
              <option value="">— wählen —</option>
              {targets.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name ?? m.userId} ({m.role})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Bestätigung"
            hint={`Tippe „${wsId}" exakt zur Bestätigung.`}
          >
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={wsId}
              className="w-full rounded-lg border border-amber-200 dark:border-amber-700/40 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100"
            />
          </Field>
          {err && <ErrorBox>{err}</ErrorBox>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setRecipientId('')
                setConfirmText('')
                setErr(null)
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={busy || !recipientId || confirmText !== wsId}
              className="bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? '…' : 'Übertragen'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function DangerZone({
  wsId,
  onDeleted,
}: {
  wsId: string
  onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleDelete() {
    if (confirmText !== wsId) return
    setBusy(true)
    setErr(null)
    try {
      await deleteWorkspace(wsId)
      onDeleted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-700/40 dark:bg-red-900/20">
      <div className="text-sm font-semibold text-red-700 dark:text-red-200">
        Workspace löschen
      </div>
      <p className="mt-1 text-xs text-red-700/80 dark:text-red-200/80">
        Soft-Delete mit 30 Tagen Recovery (CLI-only). Members verlieren sofort Zugang.
        Tippe <strong>{wsId}</strong> zum Bestätigen.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={wsId}
          className="flex-1 rounded-lg border border-red-200 bg-primary-50 dark:bg-neutral-900 px-3 py-2 text-sm text-primary-900 dark:text-neutral-100"
        />
        <Button
          type="button"
          size="sm"
          onClick={handleDelete}
          disabled={confirmText !== wsId || busy}
          className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? '…' : 'Löschen'}
        </Button>
      </div>
      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-200">{err}</p>}
    </div>
  )
}

// ── Shared UI bits ────────────────────────────────────────────────────

function Header({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-primary-500 dark:text-neutral-400">
        Settings
      </p>
      <h3 className="text-base font-semibold text-primary-900 dark:text-neutral-100">
        {title}
      </h3>
      <p className="text-xs text-primary-500 dark:text-neutral-400">
        {description}
      </p>
    </div>
  )
}

function BackBar({
  onBack,
  title,
  subtitle,
  roleBadge,
}: {
  onBack: () => void
  title: string
  subtitle?: string
  roleBadge?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        onClick={onBack}
        aria-label="Zurück"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={18} strokeWidth={1.5} />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-semibold text-primary-900 dark:text-neutral-100">
            {title}
          </span>
          {roleBadge}
        </div>
        {subtitle && (
          <div className="truncate text-xs text-primary-500 dark:text-neutral-400">
            {subtitle}
          </div>
        )}
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
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-primary-700 dark:text-neutral-300">
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-[11px] text-primary-500 dark:text-neutral-400">
          {hint}
        </p>
      )}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200 dark:bg-red-900/30 dark:text-red-200 dark:ring-red-700/40">
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-6">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary-300 border-t-accent-500" />
    </div>
  )
}

function RoleBadge({ role }: { role: 'owner' | 'admin' | 'member' }) {
  const cls =
    role === 'owner'
      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200'
      : role === 'admin'
        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
        : 'bg-primary-200 text-primary-700 dark:bg-neutral-700 dark:text-neutral-200'
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {role}
    </span>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}
