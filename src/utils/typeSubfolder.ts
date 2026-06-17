import type { VaultEntry } from '../types'
import { substituteTemplate, type TemplateContext } from './templateSubstitution'

const ILLEGAL_FOLDER_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*', '\\'])

function stripInvalidFolderChars(segment: string): string {
  return segment
    .trim()
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 0x1f && !ILLEGAL_FOLDER_CHARS.has(ch))
    .join('')
}

/** Sanitize a resolved subfolder template into a safe, normalized vault-relative
 *  folder. Parent-directory (`..`) and single-dot segments are dropped so the
 *  path cannot escape the vault; illegal cross-platform folder characters are
 *  stripped. Returns null when nothing usable remains. */
export function sanitizeSubfolderPath(raw: string): string | null {
  const segments = raw
    .split('/')
    .map(stripInvalidFolderChars)
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  const normalized = segments.join('/').replace(/^\/+|\/+$/g, '')
  return normalized.length > 0 ? normalized : null
}

/** Resolve a Type's `_subfolder_path` template against `ctx`, sanitizing the
 *  result. Returns null when the type has no template or the result is empty. */
export function resolveTypeSubfolder(
  typeEntry: VaultEntry | undefined,
  ctx: TemplateContext,
): string | null {
  if (!typeEntry?.subfolderPath) return null
  return sanitizeSubfolderPath(substituteTemplate(typeEntry.subfolderPath, ctx))
}

/** Folder precedence for immediate note creation: an explicit user-chosen folder
 *  always wins; otherwise fall back to the type's resolved subfolder; otherwise
 *  undefined (vault root). An explicit empty string is treated as an intentional
 *  root override and is preserved. */
export function effectiveImmediateFolder(
  explicitFolder: string | undefined,
  typeSubfolder: string | null,
): string | undefined {
  return explicitFolder ?? typeSubfolder ?? undefined
}
