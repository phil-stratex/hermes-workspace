import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock swarm-docker-exec BEFORE importing the file-reader so the mock
// is in place when extractAttachmentText resolves the import.
vi.mock('./swarm-docker-exec', () => ({
  useDockerExec: vi.fn(() => false),
  swarmExec: vi.fn(),
}))

import {
  extractAttachmentText,
  renderTextAttachmentsAsBlock,
  type ExtractionResult,
  type ExtractedText,
} from './file-reader'
import { swarmExec, useDockerExec } from './swarm-docker-exec'

function utf8DataUrl(text: string, mime = 'text/plain'): string {
  return `data:${mime};base64,${Buffer.from(text, 'utf-8').toString('base64')}`
}

describe('extractAttachmentText', () => {
  beforeEach(() => {
    vi.mocked(useDockerExec).mockReturnValue(false)
    vi.mocked(swarmExec).mockReset()
  })

  describe('text mime types', () => {
    it('decodes text/plain to UTF-8', async () => {
      const result = await extractAttachmentText({
        name: 'note.txt',
        contentType: 'text/plain',
        dataUrl: utf8DataUrl('Hello, world!'),
      })
      expect(result.kind).toBe('text')
      if (result.kind === 'text') {
        expect(result.text).toBe('Hello, world!')
        expect(result.contentType).toBe('text/plain')
        expect(result.truncated).toBe(false)
      }
    })

    it('decodes text/markdown', async () => {
      const result = await extractAttachmentText({
        name: 'README.md',
        contentType: 'text/markdown',
        dataUrl: utf8DataUrl('# Title\n\nBody'),
      })
      expect(result.kind).toBe('text')
      if (result.kind === 'text') {
        expect(result.text).toBe('# Title\n\nBody')
      }
    })

    it('decodes application/json', async () => {
      const result = await extractAttachmentText({
        name: 'config.json',
        contentType: 'application/json',
        dataUrl: utf8DataUrl('{"key":"value"}'),
      })
      expect(result.kind).toBe('text')
      if (result.kind === 'text') {
        expect(result.text).toBe('{"key":"value"}')
      }
    })

    it('decodes application/x-typescript', async () => {
      const result = await extractAttachmentText({
        name: 'main.ts',
        contentType: 'application/x-typescript',
        dataUrl: utf8DataUrl('export const x = 1'),
      })
      expect(result.kind).toBe('text')
    })

    it('detects text by .ts extension when mime is missing', async () => {
      const result = await extractAttachmentText({
        name: 'main.ts',
        contentType: 'application/octet-stream',
        dataUrl: utf8DataUrl('export const x = 1'),
      })
      expect(result.kind).toBe('text')
    })

    it('detects text by .py extension', async () => {
      const result = await extractAttachmentText({
        name: 'script.py',
        dataUrl: utf8DataUrl('print("hi")'),
      })
      expect(result.kind).toBe('text')
    })
  })

  describe('truncation', () => {
    it('truncates text > 200KB and adds marker', async () => {
      const big = 'x'.repeat(250 * 1024)
      const result = await extractAttachmentText({
        name: 'huge.txt',
        contentType: 'text/plain',
        dataUrl: utf8DataUrl(big),
      })
      expect(result.kind).toBe('text')
      if (result.kind === 'text') {
        expect(result.truncated).toBe(true)
        expect(result.originalSize).toBe(250 * 1024)
        expect(result.text).toContain('[…file truncated at')
        // Truncation cap should keep us under 250KB raw + the marker.
        expect(result.text.length).toBeLessThan(210 * 1024)
      }
    })

    it('does not truncate small text', async () => {
      const result = await extractAttachmentText({
        name: 'small.txt',
        contentType: 'text/plain',
        dataUrl: utf8DataUrl('short'),
      })
      if (result.kind === 'text') {
        expect(result.truncated).toBe(false)
        expect(result.text).toBe('short')
      }
    })
  })

  describe('image passthrough', () => {
    it('returns kind=image with the original dataUrl', async () => {
      const tinyPng = 'data:image/png;base64,iVBORw0KGgo='
      const result = await extractAttachmentText({
        name: 'pixel.png',
        contentType: 'image/png',
        dataUrl: tinyPng,
      })
      expect(result.kind).toBe('image')
      if (result.kind === 'image') {
        expect(result.dataUrl).toBe(tinyPng)
        expect(result.contentType).toBe('image/png')
      }
    })

    it('handles missing dataUrl on images gracefully', async () => {
      const result = await extractAttachmentText({
        name: 'noimg.jpg',
        contentType: 'image/jpeg',
      })
      expect(result.kind).toBe('image')
      if (result.kind === 'image') {
        expect(result.dataUrl).toBe('')
      }
    })
  })

  describe('PDF without docker-exec', () => {
    it('returns unsupported when useDockerExec is false', async () => {
      vi.mocked(useDockerExec).mockReturnValue(false)
      const result = await extractAttachmentText({
        name: 'doc.pdf',
        contentType: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,JVBERi0=',
      })
      expect(result.kind).toBe('unsupported')
      if (result.kind === 'unsupported') {
        expect(result.contentType).toBe('application/pdf')
        expect(result.hint).toContain('docker-exec')
      }
      expect(swarmExec).not.toHaveBeenCalled()
    })

    it('rejects an empty PDF (zero bytes)', async () => {
      vi.mocked(useDockerExec).mockReturnValue(true)
      const result = await extractAttachmentText({
        name: 'empty.pdf',
        contentType: 'application/pdf',
        dataUrl: 'data:application/pdf;base64,',
      })
      expect(result.kind).toBe('unsupported')
      if (result.kind === 'unsupported') {
        expect(result.hint).toContain('Leere PDF')
      }
    })
  })

  describe('unsupported types', () => {
    it('rejects application/zip with a hint', async () => {
      const result = await extractAttachmentText({
        name: 'archive.zip',
        contentType: 'application/zip',
        dataUrl: 'data:application/zip;base64,UEsDBA==',
      })
      expect(result.kind).toBe('unsupported')
      if (result.kind === 'unsupported') {
        expect(result.hint).toMatch(/nicht unterstützt|Text\/Markdown\/Code\/PDF/i)
      }
    })

    it('falls back to application/octet-stream when contentType is missing', async () => {
      const result = await extractAttachmentText({
        name: 'unknown.xyz',
        dataUrl: 'data:application/octet-stream;base64,AA==',
      })
      expect(result.kind).toBe('unsupported')
      if (result.kind === 'unsupported') {
        expect(result.contentType).toBe('application/octet-stream')
      }
    })
  })

  describe('robustness', () => {
    it('uses default name when none provided', async () => {
      const result = await extractAttachmentText({
        contentType: 'text/plain',
        dataUrl: utf8DataUrl('hi'),
      })
      if (result.kind === 'text') {
        expect(result.name).toBe('attachment')
      }
    })

    it('accepts base64 field as alternative to dataUrl', async () => {
      const result = await extractAttachmentText({
        name: 'note.txt',
        contentType: 'text/plain',
        base64: Buffer.from('hello').toString('base64'),
      })
      if (result.kind === 'text') {
        expect(result.text).toBe('hello')
      }
    })

    it('handles dataUrl without "data:" prefix as raw UTF-8', async () => {
      const result = await extractAttachmentText({
        name: 'note.txt',
        contentType: 'text/plain',
        dataUrl: 'plain raw text',
      })
      if (result.kind === 'text') {
        expect(result.text).toBe('plain raw text')
      }
    })
  })
})

describe('renderTextAttachmentsAsBlock', () => {
  const textResult = (name: string, text: string, truncated = false): ExtractedText => ({
    kind: 'text',
    name,
    contentType: 'text/plain',
    text,
    truncated,
    originalSize: text.length,
  })

  it('returns empty string for empty input', () => {
    expect(renderTextAttachmentsAsBlock([])).toBe('')
  })

  it('returns empty string when no text attachments are present', () => {
    const results: Array<ExtractionResult> = [
      { kind: 'image', name: 'img.png', contentType: 'image/png', dataUrl: 'data:...' },
      { kind: 'unsupported', name: 'a.zip', contentType: 'application/zip', hint: 'nope' },
    ]
    expect(renderTextAttachmentsAsBlock(results)).toBe('')
  })

  it('skips text-attachments with empty content', () => {
    const results: Array<ExtractionResult> = [
      textResult('a.txt', ''),
      textResult('b.txt', 'real content'),
    ]
    const block = renderTextAttachmentsAsBlock(results)
    expect(block).toContain('b.txt')
    expect(block).not.toContain('a.txt')
  })

  it('wraps each text in an <attachment> tag with name + content-type', () => {
    const results: Array<ExtractionResult> = [textResult('config.json', '{"x":1}')]
    const block = renderTextAttachmentsAsBlock(results)
    expect(block).toContain('<attachment name="config.json" content-type="text/plain">')
    expect(block).toContain('{"x":1}')
    expect(block).toContain('</attachment>')
  })

  it('flags truncated attachments with truncated="true"', () => {
    const results: Array<ExtractionResult> = [textResult('big.txt', 'partial', true)]
    const block = renderTextAttachmentsAsBlock(results)
    expect(block).toContain('truncated="true"')
  })

  it('escapes special chars in name + contentType (XSS-safe attribute)', () => {
    const results: Array<ExtractionResult> = [
      textResult('<script>"&', 'body'),
    ]
    const block = renderTextAttachmentsAsBlock(results)
    expect(block).toContain('&lt;script&gt;&quot;&amp;')
    expect(block).not.toContain('<script>')
  })

  it('joins multiple attachments with double-newline separator', () => {
    const results: Array<ExtractionResult> = [
      textResult('a.txt', 'first'),
      textResult('b.txt', 'second'),
    ]
    const block = renderTextAttachmentsAsBlock(results)
    const sections = block.split('\n\n<attachment')
    // Initial open + 1 separator = 2 sections.
    expect(sections).toHaveLength(2)
  })
})
