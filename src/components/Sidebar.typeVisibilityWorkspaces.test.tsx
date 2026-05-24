import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import type { SidebarSelection, VaultEntry, WorkspaceIdentity } from '../types'
import { makeEntry } from '../test-utils/noteListTestUtils'

const defaultSelection: SidebarSelection = { kind: 'filter', filter: 'all' }

const mainWorkspace: WorkspaceIdentity = {
  id: 'main',
  label: 'Main',
  alias: 'main',
  path: '/vault/main',
  shortLabel: 'MA',
  color: 'blue',
  icon: null,
  mounted: true,
  available: true,
  defaultForNewNotes: true,
}

const workWorkspace: WorkspaceIdentity = {
  id: 'work',
  label: 'Work',
  alias: 'work',
  path: '/vault/work',
  shortLabel: 'WK',
  color: 'green',
  icon: null,
  mounted: true,
  available: true,
  defaultForNewNotes: false,
}

function makeWorkspaceTypeEntry(
  title: string,
  visible: boolean | null,
  workspace: WorkspaceIdentity,
): VaultEntry {
  return makeEntry({
    path: `${workspace.path}/${title.toLowerCase()}.md`,
    filename: `${title.toLowerCase()}.md`,
    title,
    isA: 'Type',
    visible,
    workspace,
  })
}

function makeWorkspaceNote(
  title: string,
  type: string,
  workspace: WorkspaceIdentity,
): VaultEntry {
  return makeEntry({
    path: `${workspace.path}/${title.toLowerCase().replaceAll(' ', '-')}.md`,
    filename: `${title.toLowerCase().replaceAll(' ', '-')}.md`,
    title,
    isA: type,
    workspace,
  })
}

function renderSidebar(entries: VaultEntry[], onToggleTypeVisibility = vi.fn(), workspaceOrder?: readonly string[]) {
  render(
    <Sidebar
      entries={entries}
      selection={defaultSelection}
      onSelect={() => {}}
      onToggleTypeVisibility={onToggleTypeVisibility}
      workspaceOrder={workspaceOrder}
    />
  )
  return { onToggleTypeVisibility }
}

describe('Sidebar workspace type visibility', () => {
  it('shows workspace visibility columns and toggles the selected Type entry path', () => {
    const entries = [
      makeWorkspaceTypeEntry('Project', null, mainWorkspace),
      makeWorkspaceTypeEntry('Project', false, workWorkspace),
      makeWorkspaceNote('Main Project', 'Project', mainWorkspace),
      makeWorkspaceNote('Work Project', 'Project', workWorkspace),
    ]
    const { onToggleTypeVisibility } = renderSidebar(entries)

    fireEvent.click(screen.getByTitle('Customize sections'))

    expect(screen.getByTitle('Main (main)')).toHaveTextContent('MA')
    expect(screen.getByTitle('Work (work)')).toHaveTextContent('WK')

    const mainCheckbox = screen.getByRole('checkbox', { name: 'Toggle Projects MA' })
    const workCheckbox = screen.getByRole('checkbox', { name: 'Toggle Projects WK' })
    expect(mainCheckbox).toHaveAttribute('aria-checked', 'true')
    expect(workCheckbox).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(workCheckbox)
    expect(onToggleTypeVisibility).toHaveBeenCalledWith('Project', '/vault/work/project.md')
  })

  it('orders matrix columns from the vault menu order instead of Type entry discovery order', () => {
    const entries = [
      makeWorkspaceTypeEntry('Project', null, mainWorkspace),
      makeWorkspaceTypeEntry('Project', null, workWorkspace),
      makeWorkspaceNote('Main Project', 'Project', mainWorkspace),
      makeWorkspaceNote('Work Project', 'Project', workWorkspace),
    ]

    renderSidebar(entries, vi.fn(), [workWorkspace.path, mainWorkspace.path])

    fireEvent.click(screen.getByTitle('Customize sections'))

    const workHeader = screen.getByTitle('Work (work)')
    const mainHeader = screen.getByTitle('Main (main)')
    expect(workHeader.compareDocumentPosition(mainHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides a merged section only when every workspace definition is hidden', () => {
    const entries = [
      makeWorkspaceTypeEntry('Project', false, mainWorkspace),
      makeWorkspaceTypeEntry('Project', false, workWorkspace),
      makeWorkspaceNote('Main Project', 'Project', mainWorkspace),
      makeWorkspaceNote('Work Project', 'Project', workWorkspace),
    ]

    renderSidebar(entries)

    expect(screen.queryByText('Projects')).not.toBeInTheDocument()
  })
})
