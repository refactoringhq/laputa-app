import { normalizeNotePathSeparators, normalizeVaultRelativePath } from '../utils/notePathIdentity'

export interface AgentFileCallbacks {
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
}

export interface AgentFileOperation {
  toolName: string
  input?: string
  vaultPath: string
  callbacks?: AgentFileCallbacks
}

export interface BashFileCreationRequest {
  input?: string
  vaultPath: string
}

interface OperationContext extends BashFileCreationRequest {
  callbacks: AgentFileCallbacks
}

interface PathNotification {
  relativePath: string | null
  callbacks: AgentFileCallbacks
}

interface ToolInputSource {
  input?: string
}

interface ToolInputContext extends ToolInputSource {
  vaultPath: string
}

interface VaultRelativePathRequest {
  filePath: string
  vaultPath: string
}

interface NormalizedToolPath {
  value: string
  windowsStyle: boolean
}

export function detectFileOperation(operation: AgentFileOperation): void {
  if (!operation.callbacks) return
  const context = {
    input: operation.input,
    vaultPath: operation.vaultPath,
    callbacks: operation.callbacks,
  }

  switch (operation.toolName) {
    case 'Bash':
      notifyBashOperation(context)
      return
    case 'Write':
      notifyWriteOperation(context)
      return
    case 'create_note':
      notifyCreateNoteOperation(context)
      return
    case 'Edit':
      notifyEditOperation(context)
  }
}

function notifyBashOperation(context: OperationContext): void {
  notifyCreatedPath({
    relativePath: parseBashFileCreation(context),
    callbacks: context.callbacks,
  })
}

function notifyWriteOperation(context: OperationContext): void {
  notifyCreatedPath({
    relativePath: markdownPathFromToolInput(context),
    callbacks: context.callbacks,
  })
}

function notifyCreateNoteOperation(context: OperationContext): void {
  notifyCreatedPath({
    relativePath: markdownCreationPathFromToolInput(context),
    callbacks: context.callbacks,
  })
}

function notifyEditOperation(context: OperationContext): void {
  notifyModifiedPath({
    relativePath: markdownPathFromToolInput(context),
    callbacks: context.callbacks,
  })
}

function notifyCreatedPath({ relativePath, callbacks }: PathNotification): void {
  if (relativePath) {
    callbacks.onFileCreated?.(relativePath)
  } else {
    callbacks.onVaultChanged?.()
  }
}

function notifyModifiedPath({ relativePath, callbacks }: PathNotification): void {
  if (relativePath) {
    callbacks.onFileModified?.(relativePath)
  } else {
    callbacks.onVaultChanged?.()
  }
}

function markdownPathFromToolInput(context: ToolInputContext): string | null {
  return markdownVaultRelativePath({
    filePath: parseFilePath(context),
    vaultPath: context.vaultPath,
  })
}

function markdownCreationPathFromToolInput(context: ToolInputContext): string | null {
  const filePath = parseFilePath(context)
  if (!filePath?.endsWith('.md')) return null
  const notePath = normalizeToolPath(filePath)
  return isRelativePath(notePath)
    ? safeRelativeMarkdownPath(notePath)
    : markdownVaultRelativePath({ filePath, vaultPath: context.vaultPath })
}

function parseFilePath(source: ToolInputSource): string | null {
  const parsed = parseToolInput(source)
  if (!parsed) return null
  return stringField(parsed, ['file_path', 'path'])
}

function parseToolInput(source: ToolInputSource): Record<string, unknown> | null {
  if (!source.input) return null
  try {
    const parsed = JSON.parse(source.input)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = Reflect.get(record, key)
    if (typeof value === 'string') return value
  }
  return null
}

function markdownVaultRelativePath(request: {
  filePath: string | null
  vaultPath: string
}): string | null {
  if (!request.filePath || !request.filePath.endsWith('.md')) return null
  return toVaultRelative({
    filePath: request.filePath,
    vaultPath: request.vaultPath,
  })
}

function toVaultRelative({ filePath, vaultPath }: VaultRelativePathRequest): string | null {
  const vaultRoot = normalizeToolPath(vaultPath)
  const notePath = normalizeToolPath(filePath)
  return childPathInsideVault(vaultRoot, notePath)
}

function childPathInsideVault(vaultRoot: NormalizedToolPath, notePath: NormalizedToolPath): string | null {
  const prefix = `${vaultRoot.value}/`
  const caseInsensitive = vaultRoot.windowsStyle || notePath.windowsStyle
  const normalizedPrefix = caseInsensitive ? prefix.toLowerCase() : prefix
  const normalizedNotePath = caseInsensitive ? notePath.value.toLowerCase() : notePath.value
  if (!normalizedNotePath.startsWith(normalizedPrefix)) return null
  return notePath.value.slice(prefix.length) || null
}

function normalizeToolPath(value: string): NormalizedToolPath {
  return {
    value: normalizeNotePathSeparators(value).replace(/\/+$/u, ''),
    windowsStyle: /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\'),
  }
}

function isRelativePath(path: NormalizedToolPath): boolean {
  return !path.value.startsWith('/') && !path.windowsStyle
}

function safeRelativeMarkdownPath(path: NormalizedToolPath): string | null {
  const relativePath = normalizeVaultRelativePath(path.value)
  if (!relativePath || relativePath.startsWith('../') || relativePath.includes('/../')) return null
  return relativePath
}

export function parseBashFileCreation(request: BashFileCreationRequest): string | null {
  return markdownVaultRelativePath({
    filePath: markdownRedirectTarget(bashCommandFromInput(request)),
    vaultPath: request.vaultPath,
  })
}

function bashCommandFromInput(source: ToolInputSource): string | null {
  const parsed = parseToolInput(source)
  if (!parsed) return null
  return stringField(parsed, ['command', 'cmd'])
}

function markdownRedirectTarget(command: string | null): string | null {
  if (!command) return null

  for (let index = 0; index < command.length; index += 1) {
    const char = command.at(index)
    if (char === '>') {
      const target = redirectTargetAfterOperator(command, command.at(index + 1) === '>' ? index + 2 : index + 1)
      if (target) return target
    }
    if (command.startsWith('tee', index)) {
      const target = redirectTargetAfterTee(command, index + 3)
      if (target) return target
    }
  }

  return null
}

function redirectTargetAfterTee(command: string, startIndex: number): string | null {
  if (!isWhitespace(command.at(startIndex))) return null
  let index = skipWhitespace(command, startIndex)
  if (command.startsWith('-a', index) && isWhitespace(command.at(index + 2))) {
    index = skipWhitespace(command, index + 2)
  }
  return redirectTargetAfterOperator(command, index)
}

function redirectTargetAfterOperator(command: string, startIndex: number): string | null {
  const start = skipWhitespace(command, startIndex)
  const quote = command.at(start)
  const quoted = quote === '"' || quote === "'"
  const targetStart = quoted ? start + 1 : start
  const targetEnd = readRedirectTargetEnd(command, targetStart, quoted ? quote : null)
  const target = command.slice(targetStart, targetEnd)
  return target.endsWith('.md') ? target : null
}

function readRedirectTargetEnd(command: string, startIndex: number, quote: string | null): number {
  let index = startIndex
  while (index < command.length) {
    const char = command.at(index)
    if (quote ? char === quote : isRedirectTargetTerminator(char)) break
    index += 1
  }
  return index
}

function skipWhitespace(value: string, startIndex: number): number {
  let index = startIndex
  while (isWhitespace(value.at(index))) index += 1
  return index
}

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\t' || value === '\n' || value === '\r'
}

function isRedirectTargetTerminator(value: string | undefined): boolean {
  return value === undefined
    || isWhitespace(value)
    || value === '"'
    || value === "'"
    || value === '|'
    || value === ';'
}
