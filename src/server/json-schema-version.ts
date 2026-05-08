/**
 * Schema-versioning helper for persisted JSON files (members.json,
 * meta.json, sessions-meta.json, peers.json, manifest, etc.).
 *
 * Every persisted object has a top-level `schemaVersion: number`. Readers
 * call `assertSchemaVersion(value, expected, hint)` and let the throw
 * propagate. Operators see a clear "unknown schema version 99 in <file>"
 * error rather than silently parsing an unfamiliar shape into the wrong
 * defaults.
 *
 * Migration policy: when a schema bumps, accept the OLD version on read
 * and rewrite as new. `expected` accepts a single number or an array of
 * supported versions for that transitional period.
 */

export class SchemaVersionError extends Error {
  constructor(
    public readonly expected: number | readonly number[],
    public readonly actual: unknown,
    public readonly fileHint?: string,
  ) {
    const exp = Array.isArray(expected) ? `one of [${expected.join(', ')}]` : String(expected)
    const where = fileHint ? ` (file: ${fileHint})` : ''
    super(
      `[schema] version mismatch${where}: expected ${exp}, got ${JSON.stringify(actual)}`,
    )
    this.name = 'SchemaVersionError'
  }
}

export function assertSchemaVersion<T extends { schemaVersion: number }>(
  value: unknown,
  expected: number | readonly number[],
  fileHint?: string,
): T {
  if (!value || typeof value !== 'object') {
    throw new SchemaVersionError(expected, value, fileHint)
  }
  const obj = value as Record<string, unknown>
  const got = obj.schemaVersion
  const expectedArr = Array.isArray(expected) ? expected : [expected]
  if (typeof got !== 'number' || !expectedArr.includes(got)) {
    throw new SchemaVersionError(expected, got, fileHint)
  }
  return value as T
}
