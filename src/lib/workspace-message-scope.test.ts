import { describe, expect, it } from 'vitest'

import { buildWorkspaceScopedTextMessage } from './workspace-message-scope'

describe('buildWorkspaceScopedTextMessage', () => {
  it('prepends an explicit active workspace directive to plain text chat messages', () => {
    const scoped = buildWorkspaceScopedTextMessage('Run the tests', {
      path: '/Users/eric/projects/hermes-workspace',
      folderName: 'hermes-workspace',
      isValid: true,
    })
    // workspace_context line carries the identity attributes
    expect(scoped).toContain(
      '<workspace_context active="true" name="hermes-workspace" path="/Users/eric/projects/hermes-workspace" />',
    )
    // message body is preserved (separated by blank line from directive)
    expect(scoped).toMatch(/\n\nRun the tests$/)
  })

  it('includes the Stratex capabilities block so the LLM knows what surfaces exist', () => {
    const scoped = buildWorkspaceScopedTextMessage('hi', {
      path: '/x',
      folderName: 'x',
      isValid: true,
    })
    expect(scoped).toContain('<workspace_capabilities>')
    expect(scoped).toContain('auto-preview-html:')
    expect(scoped).toContain('desktop-vnc:')
    expect(scoped).toContain('swarm-dispatch:')
    expect(scoped).toContain('</workspace_capabilities>')
  })

  it('does not duplicate the directive if the message is retried', () => {
    const scoped = buildWorkspaceScopedTextMessage('Run the tests', {
      path: '/Users/eric/work',
      folderName: 'work',
      isValid: true,
    })
    expect(
      buildWorkspaceScopedTextMessage(scoped, {
        path: '/Users/eric/other',
        folderName: 'other',
        isValid: true,
      }),
    ).toBe(scoped)
  })

  it('leaves messages unchanged when no valid workspace exists', () => {
    expect(
      buildWorkspaceScopedTextMessage('hello', {
        path: '',
        folderName: '',
        isValid: false,
      }),
    ).toBe('hello')
  })
})
