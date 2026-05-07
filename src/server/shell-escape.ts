/**
 * Quote a string for safe inclusion inside single-quoted shell context.
 * Replaces `'` with the standard `'\''` sequence (close, escape, reopen).
 *
 * Use when building `sh -c "..."` strings that contain a path or value
 * derived from user input or roster data. Prefer passing arguments via
 * argv arrays where possible — escape is a fallback when the surrounding
 * shell context is unavoidable.
 */
export function shellEscapeSingle(value: string): string {
  return value.replace(/'/g, `'\\''`)
}
