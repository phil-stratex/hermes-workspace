import { describe, expect, it } from 'vitest'

import { SchemaVersionError, assertSchemaVersion } from './json-schema-version'

describe('assertSchemaVersion', () => {
  it('returns the value when version matches', () => {
    const v = { schemaVersion: 1, payload: 'ok' }
    expect(assertSchemaVersion<typeof v>(v, 1)).toBe(v)
  })

  it('accepts an array of allowed versions', () => {
    const v = { schemaVersion: 2, payload: 'ok' }
    expect(assertSchemaVersion<typeof v>(v, [1, 2])).toBe(v)
  })

  it('throws SchemaVersionError on unknown version', () => {
    const v = { schemaVersion: 99 }
    let err: unknown = null
    try {
      assertSchemaVersion(v, 1, 'meta.json')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SchemaVersionError)
    const sv = err as SchemaVersionError
    expect(sv.expected).toBe(1)
    expect(sv.actual).toBe(99)
    expect(sv.fileHint).toBe('meta.json')
    expect(sv.message).toContain('expected 1')
    expect(sv.message).toContain('99')
    expect(sv.message).toContain('meta.json')
  })

  it('throws on missing schemaVersion', () => {
    expect(() => assertSchemaVersion({}, 1)).toThrow(SchemaVersionError)
  })

  it('throws on non-number schemaVersion', () => {
    expect(() => assertSchemaVersion({ schemaVersion: '1' }, 1)).toThrow(SchemaVersionError)
  })

  it('throws on null / undefined / primitive', () => {
    expect(() => assertSchemaVersion(null, 1)).toThrow(SchemaVersionError)
    expect(() => assertSchemaVersion(undefined, 1)).toThrow(SchemaVersionError)
    expect(() => assertSchemaVersion(42, 1)).toThrow(SchemaVersionError)
    expect(() => assertSchemaVersion('hello', 1)).toThrow(SchemaVersionError)
  })

  it('formats the message readably for arrays', () => {
    let err: unknown = null
    try {
      assertSchemaVersion({ schemaVersion: 99 }, [1, 2, 3])
    } catch (e) {
      err = e
    }
    expect((err as Error).message).toContain('one of [1, 2, 3]')
  })
})
