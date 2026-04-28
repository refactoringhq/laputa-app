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

type OperationHandler = (context: OperationContext) => void

const OPERATION_HANDLERS: Record<string, OperationHandler> = {
  Bash: notifyBashOperation,
  Write: notifyWriteOperation,
  Edit: notifyEditOperation,
}

export function detectFileOperation(operation: AgentFileOperation): void {
  if (!operation.callbacks) return
  OPERATION_HANDLERS[operation.toolName]?.({
    input: operation.input,
    vaultPath: operation.vaultPath,
    callbacks: operation.callbacks,
  })
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
    const value = record[key]
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
  const vaultRoot = vaultPath.replace(/\/+$/, '')
  const prefix = `${vaultRoot}/`
  if (!filePath.startsWith(prefix)) return null
  return filePath.slice(prefix.length) || null
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
  return command?.match(/(?:>|>>|tee\s+(?:-a\s+)?)\s*["']?([^\s"'|;]+\.md)["']?/)?.[1] ?? null
}
