import { useState, type KeyboardEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, UserCircleIcon, Telescope01Icon } from '@hugeicons/core-free-icons'
import type { ChatHistoryMessage } from '@/server/predict-client'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

export function ChatConversation({
  title,
  subtitle,
  messages,
  busy,
  disabled,
  onSend,
  inputPlaceholder,
}: {
  title: string
  subtitle?: string
  messages: Array<ChatHistoryMessage>
  busy: boolean
  disabled?: boolean
  onSend: (text: string) => void
  inputPlaceholder?: string
}) {
  const [draft, setDraft] = useState('')

  const handleSubmit = () => {
    const trimmed = draft.trim()
    if (!trimmed || busy || disabled) return
    onSend(trimmed)
    setDraft('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="text-xs text-[var(--theme-muted)]">{subtitle}</p> : null}
      </header>

      <ul className="flex flex-1 flex-col gap-3 overflow-auto">
        {messages.length === 0 ? (
          <li className="m-auto max-w-md text-center text-xs text-[var(--theme-muted)]">
            {disabled
              ? 'Wähle erst einen Gesprächspartner aus.'
              : 'Stell die erste Frage — der Verlauf erscheint hier.'}
          </li>
        ) : (
          messages.map((msg) => <Message key={msg.id} message={msg} />)
        )}
      </ul>

      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || busy}
          placeholder={inputPlaceholder ?? 'Frage formulieren — Enter zum Senden, Shift+Enter für Zeilenumbruch'}
          rows={2}
          className="w-full resize-none bg-transparent text-sm focus:outline-none disabled:opacity-50"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-[var(--theme-muted)]">
            {disabled ? 'Auswahl fehlt' : busy ? 'Antwort wird generiert…' : `${draft.length} Zeichen`}
          </span>
          <button
            type="button"
            disabled={disabled || busy || draft.trim().length === 0}
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--theme-accent)] px-3 py-1 text-xs font-semibold text-primary-950 hover:bg-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Senden
            <HugeiconsIcon icon={ArrowRight01Icon} size={11} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Message({ message }: { message: ChatHistoryMessage }) {
  const isUser = message.role === 'user'
  return (
    <li className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isUser
            ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]'
            : 'bg-[var(--theme-bg)] text-[var(--theme-muted)]',
        )}
        aria-hidden="true"
      >
        <HugeiconsIcon icon={isUser ? UserCircleIcon : Telescope01Icon} size={14} />
      </div>
      <div
        className={cn(
          'min-w-0 max-w-[80%] rounded-2xl px-4 py-2 text-sm',
          isUser
            ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-text)]'
            : 'bg-[var(--theme-bg)] text-[var(--theme-text)]',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none text-[var(--theme-text)]">
            <Markdown>{message.content}</Markdown>
          </div>
        )}
      </div>
    </li>
  )
}
