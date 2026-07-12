import type { VaultEntry } from '../../types'
import { attachmentAssetUrlFromPath } from '../../utils/vaultAttachments'
import { isImagePreviewEntry } from '../../utils/filePreview'
import { isTauri } from '../../mock-tauri'

// Reuse the existing image resolution pipeline from vaultImages.ts
// which handles: vault-relative, note-relative, attachments/, and absolute paths
import { resolveImageUrl } from '../../utils/vaultImages'

const DIRECT_IMAGE_PROTOCOLS = ['http:', 'https:', 'asset:'] as const

function resolveBinaryCardImage(entry: VaultEntry): string | null {
  if (entry.fileKind !== 'binary' || !isImagePreviewEntry(entry) || !isTauri()) return null
  return attachmentAssetUrlFromPath({ path: entry.path })
}

function imageSourceFromIcon(icon?: string | null): string | null {
  const trimmed = icon?.trim()
  if (!trimmed) return null
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed
  if (/\.(?:avif|bmp|gif|jpe?g|png|svg|webp|tiff?)$/iu.test(trimmed)) return trimmed
  return null
}

function cardImageSource(entry: VaultEntry): string | null {
  return entry.firstImage ?? imageSourceFromIcon(entry.icon)
}

function directImageUrl(imageSource: string): string | null {
  return DIRECT_IMAGE_PROTOCOLS.some((protocol) => imageSource.startsWith(protocol)) ? imageSource : null
}

function resolveVaultCardImage(entry: VaultEntry, imageSource: string, vaultPath?: string): string | null {
  const resolvedVaultPath = vaultPath ?? entry.workspace?.path
  if (!resolvedVaultPath) return null

  return resolveImageUrl({
    url: imageSource,
    vaultPath: resolvedVaultPath,
    notePath: entry.path,
  })
}

function resolveMarkdownCardImage(entry: VaultEntry, vaultPath?: string): string | null {
  const imageSource = cardImageSource(entry)
  if (!imageSource) return null

  return directImageUrl(imageSource) ?? resolveVaultCardImage(entry, imageSource, vaultPath)
}

function resolveCardImage(entry: VaultEntry, vaultPath?: string): string | null {
  if (!isTauri()) return null
  return resolveBinaryCardImage(entry) ?? resolveMarkdownCardImage(entry, vaultPath)
}

const PLACEHOLDER_COLORS = [
  '#4a5568', '#5b4636', '#3b4d5a', '#5a3b4d', '#3b5a4a', '#5a4a3b',
  '#4d3b5a', '#3b5a5a', '#5a5a3b', '#4a3b4d',
]

function placeholderColor(title: string): string {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = ((hash << 5) - hash) + title.charCodeAt(i)
    hash |= 0
  }
  return PLACEHOLDER_COLORS[Math.abs(hash) % PLACEHOLDER_COLORS.length]
}

export function NoteCardView({
  entries,
  vaultPath,
  selectedNotePath,
  onSelectNote,
}: {
  entries: VaultEntry[]
  vaultPath?: string
  selectedNotePath: string | null
  onSelectNote: (entry: VaultEntry) => void
}) {
  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No notes in this view.
        </p>
      </div>
    )
  }

  return (
    <div
      className="h-full overflow-y-auto p-3"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gridAutoRows: 'min-content', gap: '14px', alignContent: 'start' }}
    >
      {entries.map((entry) => {
        const thumbnail = resolveCardImage(entry, vaultPath)
        const isSelected = selectedNotePath === entry.path
        const bgColor = thumbnail ? undefined : placeholderColor(entry.title)
        return (
          <button
            key={entry.path}
            type="button"
            onClick={() => onSelectNote(entry)}
            className="group relative overflow-hidden rounded-xl border-0 text-left transition-transform hover:scale-[1.02]"
            style={{
              width: '100%',
              aspectRatio: '4 / 3',
              cursor: 'pointer',
              borderLeft: isSelected ? '3px solid var(--accent-blue)' : '3px solid transparent',
              backgroundColor: bgColor ?? 'var(--muted)',
            }}
          >
            {thumbnail && (
              <img
                src={thumbnail}
                alt=""
                className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
                onError={(e) => {
                  (e.currentTarget.parentElement as HTMLElement).style.backgroundColor = placeholderColor(entry.title)
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <div
              className="absolute inset-x-0 bottom-0 p-3"
              style={{
                background: thumbnail
                  ? 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)'
                  : 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
              }}
            >
              <p
                className="truncate text-[16px] font-bold text-white"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
              >
                {entry.title}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}