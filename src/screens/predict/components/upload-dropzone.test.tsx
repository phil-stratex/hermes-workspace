// @vitest-environment jsdom
/**
 * Tests for UploadDropzone — pure component-level coverage.
 *
 * Uses React.act + createRoot directly (not @testing-library/react render) to
 * avoid the vitest ESM/CJS dual-instance issue with React 19 hooks in jsdom.
 * Pattern lifted from src/screens/mcp/-marketplace-install-confirmation.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Stub hugeicons so the CJS bundle is not pulled into vitest's transform.
// Hoisted by vi.mock() before component import.
vi.mock('@hugeicons/react', () => ({
  HugeiconsIcon: () => null,
}))
vi.mock('@hugeicons/core-free-icons', () => ({
  CloudUploadIcon: {},
  File01Icon: {},
  Delete02Icon: {},
  CheckmarkCircle02Icon: {},
  AlertCircleIcon: {},
}))

import { UploadDropzone } from './upload-dropzone'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Mounted = {
  container: HTMLDivElement
  unmount: () => Promise<void>
}

async function mount(element: React.ReactElement): Promise<Mounted> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await React.act(async () => {
    root.render(element)
  })
  return {
    container,
    unmount: async () => {
      await React.act(async () => {
        root.unmount()
      })
      document.body.removeChild(container)
    },
  }
}

/** Build a File with explicit size for size-bound tests. */
function makeFile(name: string, sizeBytes: number, type = 'application/pdf'): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: sizeBytes })
  return file
}

function fireChange(input: HTMLInputElement, files: Array<File>) {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: Object.assign(files, {
      item: (i: number) => files[i] ?? null,
    }) as unknown as FileList,
  })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

describe('UploadDropzone — initial render', () => {
  it('renders the empty dropzone with helper copy', async () => {
    const onChange = vi.fn()
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [], onChange }),
    )
    expect(container.textContent).toContain('PDF, Markdown oder Text hier ablegen')
    expect(container.querySelectorAll('li').length).toBe(0)
    expect(onChange).not.toHaveBeenCalled()
    await unmount()
  })

  it('renders file rows when files prop has entries', async () => {
    const f = makeFile('spec.pdf', 1024)
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [f], onChange: vi.fn() }),
    )
    expect(container.textContent).toContain('spec.pdf')
    expect(container.querySelectorAll('li').length).toBe(1)
    await unmount()
  })
})

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

describe('UploadDropzone — file selection', () => {
  it('forwards an accepted file to onChange', async () => {
    const onChange = vi.fn()
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [], onChange }),
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).toBeTruthy()

    await React.act(async () => {
      fireChange(input, [makeFile('notes.md', 2048, 'text/markdown')])
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as Array<File>
    expect(next).toHaveLength(1)
    expect(next[0].name).toBe('notes.md')
    await unmount()
  })

  it('rejects unsupported extensions (.exe) — file is filtered out', async () => {
    const onChange = vi.fn()
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [], onChange }),
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await React.act(async () => {
      fireChange(input, [makeFile('virus.exe', 100, 'application/octet-stream')])
    })

    // The visible "Übersprungen" notice is rendered.
    expect(container.textContent).toMatch(/Übersprungen.*virus\.exe/)
    // Even if onChange fires (with merged === [files]), the rejected file is gone.
    if (onChange.mock.calls.length > 0) {
      const next = onChange.mock.calls[0][0] as Array<File>
      expect(next.find((f) => f.name === 'virus.exe')).toBeUndefined()
    }
    await unmount()
  })

  it('blocks selection when total exceeds 50MB and shows error', async () => {
    const onChange = vi.fn()
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [], onChange }),
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    await React.act(async () => {
      fireChange(input, [makeFile('huge.pdf', 60 * 1024 * 1024)])
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(container.textContent).toMatch(/Gesamtgröße über/)
    await unmount()
  })

  it('caps at 8 files — 9-file selection blocked with cap error', async () => {
    const onChange = vi.fn()
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [], onChange }),
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const many = Array.from({ length: 9 }, (_, i) => makeFile(`doc-${i}.pdf`, 1024))

    await React.act(async () => {
      fireChange(input, many)
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(container.textContent).toMatch(/Maximal 8 Dateien/)
    await unmount()
  })

  it('removes a file when its delete button is clicked', async () => {
    const onChange = vi.fn()
    const f = makeFile('keep.md', 100, 'text/markdown')
    const g = makeFile('drop.md', 200, 'text/markdown')
    const { container, unmount } = await mount(
      React.createElement(UploadDropzone, { files: [f, g], onChange }),
    )

    const removeBtn = container.querySelector(
      'button[aria-label="Remove drop.md"]',
    ) as HTMLButtonElement
    expect(removeBtn).toBeTruthy()
    await React.act(async () => {
      removeBtn.click()
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0][0] as Array<File>
    expect(next.map((x) => x.name)).toEqual(['keep.md'])
    await unmount()
  })
})
