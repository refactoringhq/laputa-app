import type { Settings } from '../types'

export const DEFAULT_HIDE_GITIGNORED_FILES = true

export function shouldHideGitignoredFiles(settings: Pick<Settings, 'hide_gitignored_files'>): boolean {
  return settings.hide_gitignored_files ?? DEFAULT_HIDE_GITIGNORED_FILES
}
