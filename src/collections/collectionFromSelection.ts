import type { SidebarFilter, SidebarSelection, ViewFile } from '../types'
import { viewMatchesSelection } from '../utils/viewIdentity'
import { defaultListPresentation, presentationFromViewDefinition } from './presentationConfig'
import type { CollectionDefinition } from './collectionTypes'

interface CollectionContext {
  views?: ViewFile[]
}

const BUILTIN_LABELS: Record<SidebarFilter, string> = {
  all: 'All Notes',
  archived: 'Archived',
  changes: 'Changes',
  pulse: 'Pulse',
  inbox: 'Inbox',
  favorites: 'Favorites',
}

function folderLabel(selection: Extract<SidebarSelection, { kind: 'folder' }>): string {
  return selection.path || 'Vault'
}

function identityPart(value: string | undefined): string {
  return value ?? ''
}

function selectedView(selection: SidebarSelection, views?: ViewFile[]): ViewFile | undefined {
  return selection.kind === 'view'
    ? views?.find((view) => viewMatchesSelection(view, selection))
    : undefined
}

export function collectionFromSelection(
  selection: SidebarSelection,
  context: CollectionContext = {},
): CollectionDefinition {
  if (selection.kind === 'filter') {
    return {
      id: `builtin:${selection.filter}`,
      label: BUILTIN_LABELS[selection.filter],
      origin: 'builtin',
      selection,
      presentation: defaultListPresentation(),
    }
  }

  if (selection.kind === 'sectionGroup') {
    return {
      id: `type:${selection.type}`,
      label: selection.type,
      origin: 'type',
      selection,
      presentation: defaultListPresentation(),
    }
  }

  if (selection.kind === 'folder') {
    return {
      id: `folder:${identityPart(selection.rootPath)}:${selection.path}`,
      label: folderLabel(selection),
      origin: 'folder',
      selection,
      presentation: defaultListPresentation(),
    }
  }

  if (selection.kind === 'entity') {
    return {
      id: `neighborhood:${selection.entry.path}`,
      label: selection.entry.title,
      origin: 'neighborhood',
      selection,
      presentation: defaultListPresentation(),
      entry: selection.entry,
    }
  }

  const view = selectedView(selection, context.views)
  return {
    id: `saved-view:${identityPart(selection.rootPath)}:${selection.filename}`,
    label: view?.definition.name ?? selection.filename,
    origin: 'saved-view',
    selection,
    presentation: view ? presentationFromViewDefinition(view.definition) : defaultListPresentation(),
    filter: view?.definition.filters,
    view,
  }
}
