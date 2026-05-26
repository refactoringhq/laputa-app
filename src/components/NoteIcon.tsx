import { useCallback, useEffect } from 'react'
import { NoteTitleIcon } from './NoteTitleIcon'
import { focusNoteIconPropertyEditor } from './noteIconPropertyEvents'
import { resolveNoteIcon } from '../utils/noteIcon'

interface NoteIconProps {
  icon: string | null
  editable?: boolean
}

export function NoteIcon({ icon, editable = true }: NoteIconProps) {
  const hasIcon = resolveNoteIcon(icon).kind !== 'none'

  // Listen for command palette "Set Note Icon" event
  useEffect(() => {
    if (!editable) return
    const handler = () => focusNoteIconPropertyEditor()
    window.addEventListener('laputa:open-icon-picker', handler)
    return () => window.removeEventListener('laputa:open-icon-picker', handler)
  }, [editable])

  const handleActivate = useCallback(() => {
    if (!editable) return
    focusNoteIconPropertyEditor()
  }, [editable])

  return (
    <div className="note-icon-area" data-testid="note-icon-area" style={{ position: 'relative' }}>
      {hasIcon ? (
        <button type="button"
          className="note-icon-button note-icon-button--active"
          onClick={handleActivate}
          data-testid="note-icon-display"
          title={editable ? 'Edit icon' : undefined}
          disabled={!editable}
        >
          <NoteTitleIcon icon={icon} size={26} />
        </button>
      ) : (
        editable && (
          <button type="button"
            className="note-icon-button note-icon-button--add"
            onClick={handleActivate}
            data-testid="note-icon-add"
            title="Add icon"
          >
            <span className="note-icon-button__plus">+</span>
            <span className="note-icon-button__label">Add icon</span>
          </button>
        )
      )}
    </div>
  )
}
