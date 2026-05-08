/**
 * Privacy-Filter brand for session lists.
 *
 * `FilteredSessions<T>` is `readonly T[]` plus a `unique symbol` brand that
 * proves the list went through the workspace privacy filter
 * (`sessions-privacy.ts`). Endpoints that return sessions declare this as
 * their return type — `tsc` then refuses to compile any code path that
 * yields a raw session array, so a forgotten filter call surfaces at
 * compile time, not at runtime.
 *
 * The brand is a `unique symbol` so it cannot be forged via object literal
 * (you can't write `{ [__filteredBrand]: true }` — the symbol isn't in
 * scope outside this module).
 *
 * The only legitimate way to mint a `FilteredSessions<T>` is via
 * `_markAsFiltered()`, which `sessions-privacy.ts` calls after applying
 * the visibility check. The leading underscore + `@internal` JSDoc signal
 * that no other module should import it.
 */

declare const __filteredBrand: unique symbol

export type FilteredSessions<T> = readonly T[] & {
  readonly [__filteredBrand]: true
}

/**
 * Mints a branded `FilteredSessions<T>`. Internal — only `sessions-privacy.ts`
 * may import this. Other modules MUST go through `filterVisibleSessions()`.
 *
 * @internal
 */
export function _markAsFiltered<T>(items: readonly T[]): FilteredSessions<T> {
  return items as FilteredSessions<T>
}
