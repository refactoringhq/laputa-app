export const RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS = ['previousBlockType'] as const

type RichEditorBlockNotePerformanceOptions = {
  animations: false
  disableExtensions: string[]
}

export const RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS = {
  animations: false,
  disableExtensions: [...RICH_EDITOR_DISABLED_BLOCKNOTE_EXTENSIONS],
} satisfies RichEditorBlockNotePerformanceOptions
