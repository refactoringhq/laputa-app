import type { SidebarSelection } from '../types'

export const INBOX_SELECTION: SidebarSelection = { kind: 'filter', filter: 'inbox' }
export const ALL_NOTES_SELECTION: SidebarSelection = { kind: 'filter', filter: 'all' }

export function isExplicitOrganizationEnabled(explicitOrganization?: boolean | null): boolean {
  return explicitOrganization !== false
}

export function getDefaultSelectionForOrganization(explicitOrganization?: boolean | null): SidebarSelection {
  return isExplicitOrganizationEnabled(explicitOrganization) ? INBOX_SELECTION : ALL_NOTES_SELECTION
}

function shouldReplaceInboxSelection(
  selection: SidebarSelection,
  explicitOrganization?: boolean | null,
): boolean {
  return !isExplicitOrganizationEnabled(explicitOrganization) && selection.kind === 'filter' && selection.filter === 'inbox'
}

export function sanitizeSelectionForOrganization(
  selection: SidebarSelection,
  explicitOrganization?: boolean | null,
): SidebarSelection {
  if (shouldReplaceInboxSelection(selection, explicitOrganization)) {
    return ALL_NOTES_SELECTION
  }
  return selection
}
