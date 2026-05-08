import { describe, expect, it } from 'vitest'

import { _markAsFiltered } from './sessions-types'
import type { FilteredSessions } from './sessions-types'

// ─── Compile-time guarantees ──────────────────────────────────────────
//
// These checks are not asserted at runtime; if the TypeScript shape ever
// regresses, `pnpm typecheck` fails and the file won't compile.
//
// 1. Casting a raw array to FilteredSessions WITHOUT going through
//    `_markAsFiltered` must fail. We use `// @ts-expect-error` so any
//    accidental relaxation of the brand makes the test fail.
//
// 2. `_markAsFiltered` is the only legal mint path.

type Session = { id: string; ownerId: string }

// Legal: brand minted via the helper.
function pretend_filterVisibleSessions(items: readonly Session[]): FilteredSessions<Session> {
  return _markAsFiltered(items)
}

// Illegal: cannot mint a branded value from an arbitrary array.
// @ts-expect-error — raw array is missing the unique-symbol brand
const _illegal: FilteredSessions<Session> = [{ id: 'a', ownerId: 'phil' }]
void _illegal

// Illegal: cannot forge the brand via object literal — the symbol is not
// exported, so this assignment is unrepresentable at the call site.
// @ts-expect-error — unique-symbol brand is not in scope here
const _forged: FilteredSessions<Session> = Object.assign([], { __filteredBrand: true })
void _forged

describe('FilteredSessions brand', () => {
  it('only `_markAsFiltered` mints a value the type system accepts', () => {
    const out = pretend_filterVisibleSessions([{ id: 's1', ownerId: 'phil' }])
    // Runtime: still a normal array, brand is purely a TS phantom.
    expect(Array.isArray(out)).toBe(true)
    expect(out.length).toBe(1)
    expect(out[0]).toEqual({ id: 's1', ownerId: 'phil' })
  })

  it('preserves identity (the helper is a tagged cast, not a copy)', () => {
    const items: Array<Session> = [{ id: 's1', ownerId: 'phil' }]
    const branded = _markAsFiltered(items)
    expect(branded).toBe(items)
  })
})
