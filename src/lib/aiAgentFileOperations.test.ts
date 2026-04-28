import { describe, expect, it, vi } from 'vitest'
import {
  detectFileOperation,
  parseBashFileCreation,
  type AgentFileCallbacks,
} from './aiAgentFileOperations'

const VAULT = '/Users/luca/Laputa'

function makeCallbacks() {
  return {
    onFileCreated: vi.fn(),
    onFileModified: vi.fn(),
    onVaultChanged: vi.fn(),
  } satisfies AgentFileCallbacks
}

describe('detectFileOperation', () => {
  it('calls onFileCreated for Write tool with .md in vault', () => {
    const cb = makeCallbacks()
    detectFileOperation({ toolName: 'Write', input: JSON.stringify({ file_path: `${VAULT}/note/test.md` }), vaultPath: VAULT, callbacks: cb })
    expect(cb.onFileCreated).toHaveBeenCalledWith('note/test.md')
    expect(cb.onFileModified).not.toHaveBeenCalled()
  })

  it('calls onFileModified for Edit tool with .md in vault', () => {
    const cb = makeCallbacks()
    detectFileOperation({ toolName: 'Edit', input: JSON.stringify({ file_path: `${VAULT}/note/test.md` }), vaultPath: VAULT, callbacks: cb })
    expect(cb.onFileModified).toHaveBeenCalledWith('note/test.md')
    expect(cb.onFileCreated).not.toHaveBeenCalled()
  })

  it('refreshes the vault when a writable tool target cannot be resolved', () => {
    const cb = makeCallbacks()
    detectFileOperation({ toolName: 'Write', input: 'not-json', vaultPath: VAULT, callbacks: cb })
    detectFileOperation({ toolName: 'Edit', vaultPath: VAULT, callbacks: cb })
    expect(cb.onVaultChanged).toHaveBeenCalledTimes(2)
  })

  it('does not treat path prefixes as files inside the vault', () => {
    const cb = makeCallbacks()
    detectFileOperation({ toolName: 'Write', input: JSON.stringify({ file_path: `${VAULT}-old/note.md` }), vaultPath: VAULT, callbacks: cb })
    expect(cb.onFileCreated).not.toHaveBeenCalled()
    expect(cb.onVaultChanged).toHaveBeenCalledOnce()
  })

  it('detects Bash redirects and tee writes for markdown files in the vault', () => {
    expect(parseBashFileCreation({ input: JSON.stringify({ command: `echo "# Title" > ${VAULT}/note.md` }), vaultPath: VAULT })).toBe('note.md')
    expect(parseBashFileCreation({ input: JSON.stringify({ command: `echo "line" >> ${VAULT}/sub/note.md` }), vaultPath: VAULT })).toBe('sub/note.md')
    expect(parseBashFileCreation({ input: JSON.stringify({ command: `echo "data" | tee -a ${VAULT}/new.md` }), vaultPath: VAULT })).toBe('new.md')
  })

  it('refreshes the vault for Bash when no specific markdown target is found', () => {
    const cb = makeCallbacks()
    detectFileOperation({ toolName: 'Bash', input: JSON.stringify({ command: 'ls -la' }), vaultPath: VAULT, callbacks: cb })
    expect(cb.onFileCreated).not.toHaveBeenCalled()
    expect(cb.onVaultChanged).toHaveBeenCalledOnce()
  })

  it('ignores read-only tools and missing callbacks', () => {
    const cb = makeCallbacks()
    expect(() => detectFileOperation({ toolName: 'Write', input: JSON.stringify({ file_path: `${VAULT}/note/test.md` }), vaultPath: VAULT })).not.toThrow()
    detectFileOperation({ toolName: 'Read', input: JSON.stringify({ file_path: `${VAULT}/note/test.md` }), vaultPath: VAULT, callbacks: cb })
    expect(cb.onFileCreated).not.toHaveBeenCalled()
    expect(cb.onVaultChanged).not.toHaveBeenCalled()
  })
})
