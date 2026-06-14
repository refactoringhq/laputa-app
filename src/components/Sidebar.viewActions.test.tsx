import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'
import type { SidebarSelection, VaultEntry } from '../types'

const defaultSelection: SidebarSelection = { kind: 'filter', filter: 'all' }

const entries: VaultEntry[] = [{
  path: '/vault/project/build-app.md',
  filename: 'build-app.md',
  title: 'Build Laputa App',
  isA: 'Project',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  owner: null,
  cadence: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: null,
  fileSize: 200,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  outgoingLinks: [],
  properties: {},
}]

const views = [{
  filename: 'active-projects.yml',
  definition: {
    name: 'Active Projects',
    icon: '🚀',
    color: null,
    sort: null,
    filters: { all: [{ field: 'type', op: 'equals' as const, value: 'Project' }] },
  },
}]

function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}) {
  render(
    <Sidebar
      entries={entries}
      selection={defaultSelection}
      onSelect={() => {}}
      views={views}
      onDeleteView={() => {}}
      onEditView={() => {}}
      onUpdateViewDefinition={() => {}}
      {...props}
    />,
  )
}

function openViewContextMenu(options: Partial<MouseEvent> = {}) {
  fireEvent.contextMenu(screen.getByText('Active Projects').closest('[class*="cursor-pointer"]')!, options)
}

afterEach(() => {
  document.documentElement.style.removeProperty('zoom')
  document.documentElement.style.removeProperty('--tolaria-overlay-zoom-factor')
  document.documentElement.style.removeProperty('--tolaria-overlay-zoom-inverse')
})

describe('Sidebar View row actions', () => {
  it('sizes the View context menu to visible actions instead of filling the viewport', () => {
    renderSidebar()
    openViewContextMenu()

    const menu = screen.getByTestId('sidebar-view-context-menu')
    expect(menu).toHaveClass('inline-flex')
    expect(menu).toHaveClass('w-fit')
    expect(menu).toHaveClass('max-w-[calc(100vw-16px)]')
    expect(menu.style.minWidth).toBe('')
  })

  it('positions the View context menu at the pointer while the app is zoomed', () => {
    document.documentElement.style.setProperty('zoom', '130%')
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', '1.3')
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-inverse', String(1 / 1.3))
    renderSidebar()

    openViewContextMenu({ clientX: 130, clientY: 260 })

    const menu = screen.getByTestId('sidebar-view-context-menu')
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('200px')
  })
})
