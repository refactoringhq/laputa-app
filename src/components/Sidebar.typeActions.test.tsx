import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import type { SidebarSelection, VaultEntry } from '../types'

const defaultSelection: SidebarSelection = { kind: 'filter', filter: 'active' }

function makeEntry(overrides: {
  path: string
  filename: string
  title: string
  isA: string
}): VaultEntry {
  return {
    ...overrides,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
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
  }
}

const projectNote = makeEntry({
  path: '/vault/project/build-app.md',
  filename: 'build-app.md',
  title: 'Build Laputa App',
  isA: 'Project',
})

const projectTypeEntry = makeEntry({
  path: '/vault/project.md',
  filename: 'project.md',
  title: 'Project',
  isA: 'Type',
})

const entries = [projectNote]

function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      entries={entries}
      selection={defaultSelection}
      onSelect={() => {}}
      {...props}
    />,
  )
}

function getProjectsHeader() {
  return screen.getByText('Projects').closest('[class*="group/section"]') as HTMLElement
}

function openProjectsContextMenu() {
  renderSidebar()
  fireEvent.contextMenu(getProjectsHeader())
}

afterEach(() => {
  document.documentElement.style.removeProperty('zoom')
  document.documentElement.style.removeProperty('--tolaria-overlay-zoom-factor')
  document.documentElement.style.removeProperty('--tolaria-overlay-zoom-inverse')
})

describe('Sidebar Type row actions', () => {
  it('shows Type-specific context menu labels on right-click', () => {
    openProjectsContextMenu()
    expect(screen.getByText('Change display name…')).toBeInTheDocument()
    expect(screen.getByText('Customize icon & color…')).toBeInTheDocument()
    expect(screen.getByText('Delete type')).toBeInTheDocument()
  })

  it('sizes the type context menu to visible actions instead of filling the viewport', () => {
    openProjectsContextMenu()

    const menu = screen.getByTestId('sidebar-type-context-menu')
    expect(menu).toHaveClass('inline-flex')
    expect(menu).toHaveClass('w-fit')
    expect(menu).toHaveClass('max-w-[calc(100vw-16px)]')
    expect(menu.style.minWidth).toBe('')
  })

  it('positions the type context menu at the pointer while the app is zoomed', () => {
    document.documentElement.style.setProperty('zoom', '130%')
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', '1.3')
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-inverse', String(1 / 1.3))
    renderSidebar()

    fireEvent.contextMenu(getProjectsHeader(), { clientX: 130, clientY: 260 })

    const menu = screen.getByTestId('sidebar-type-context-menu')
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('200px')
  })

  it('dismisses the type context menu on Escape', () => {
    openProjectsContextMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Change display name…')).not.toBeInTheDocument()
  })

  it('calls onDeleteType from the context menu', () => {
    const onDeleteType = vi.fn()
    renderSidebar({ onDeleteType })
    fireEvent.contextMenu(getProjectsHeader())
    fireEvent.click(screen.getByText('Delete type'))
    expect(onDeleteType).toHaveBeenCalledWith('Project')
  })

  it('starts inline rename from the context menu', () => {
    openProjectsContextMenu()
    fireEvent.click(screen.getByText('Change display name…'))
    expect(screen.getByRole('textbox', { name: 'Section name' })).toBeInTheDocument()
  })

  it('starts inline rename when the type label is double-clicked', () => {
    renderSidebar()
    fireEvent.doubleClick(screen.getByText('Projects'))
    expect(screen.getByRole('textbox', { name: 'Section name' })).toBeInTheDocument()
  })

  it('submits the renamed type label on Enter', () => {
    const onRenameSection = vi.fn()
    renderSidebar({ onRenameSection })
    fireEvent.contextMenu(getProjectsHeader())
    fireEvent.click(screen.getByText('Change display name…'))
    const input = screen.getByRole('textbox', { name: 'Section name' })

    fireEvent.change(input, { target: { value: 'My Projects' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameSection).toHaveBeenCalledWith('Project', 'My Projects')
  })

  it('cancels inline rename on Escape', () => {
    const onRenameSection = vi.fn()
    renderSidebar({ onRenameSection })
    fireEvent.contextMenu(getProjectsHeader())
    fireEvent.click(screen.getByText('Change display name…'))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Section name' }), { key: 'Escape' })

    expect(onRenameSection).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Section name' })).not.toBeInTheDocument()
  })

  it('opens the Type note when a type row is double-clicked away from the label', () => {
    const onSelectNote = vi.fn()
    renderSidebar({ entries: [...entries, projectTypeEntry], onSelectNote })
    fireEvent.doubleClick(getProjectsHeader())
    expect(onSelectNote).toHaveBeenCalledWith(projectTypeEntry)
  })
})
