import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceIdentity } from '../types'
import { WorkspaceSelector } from './WorkspaceSelector'

const personalWorkspace: WorkspaceIdentity = {
  id: 'personal',
  label: 'Personal',
  alias: 'personal',
  path: '/personal',
  shortLabel: 'PE',
  color: 'green',
  icon: null,
  mounted: true,
  available: true,
  defaultForNewNotes: true,
}

const teamWorkspace: WorkspaceIdentity = {
  id: 'team',
  label: 'Team',
  alias: 'team',
  path: '/team',
  shortLabel: 'TE',
  color: 'purple',
  icon: null,
  mounted: true,
  available: true,
  defaultForNewNotes: false,
}

function renderWorkspaceSelector(overrides: Partial<ComponentProps<typeof WorkspaceSelector>> = {}) {
  const onChangeWorkspace = vi.fn()
  render(
    <WorkspaceSelector
      currentWorkspace={personalWorkspace}
      workspaces={[personalWorkspace, teamWorkspace]}
      onChangeWorkspace={onChangeWorkspace}
      {...overrides}
    />,
  )
  return { onChangeWorkspace }
}

function openWorkspaceCombobox() {
  fireEvent.click(screen.getByRole('combobox'))
}

describe('WorkspaceSelector', () => {
  it('renders the current workspace above properties as a chip-style combobox', () => {
    renderWorkspaceSelector()

    expect(screen.getByTestId('workspace-selector')).toBeInTheDocument()
    const trigger = screen.getByRole('combobox', { name: /personal/i })
    expect(trigger.getAttribute('style')).toContain('color: var(--accent-green)')
    expect(trigger.getAttribute('style')).toContain('background: var(--accent-green-light)')
  })

  it('keeps the workspace dropdown open after clicking the trigger', () => {
    renderWorkspaceSelector()

    fireEvent.click(screen.getByRole('combobox', { name: /personal/i }))

    expect(screen.getByTestId('workspace-selector-search-input')).toBeInTheDocument()
  })

  it('filters workspaces and selects a different workspace', () => {
    const { onChangeWorkspace } = renderWorkspaceSelector()

    openWorkspaceCombobox()
    fireEvent.change(screen.getByTestId('workspace-selector-search-input'), { target: { value: 'tea' } })
    fireEvent.click(screen.getByRole('option', { name: 'Team' }))

    expect(onChangeWorkspace).toHaveBeenCalledWith(teamWorkspace)
  })

  it('handles rejected workspace changes without an unhandled rejection', async () => {
    const error = new Error('move failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWorkspaceSelector({ onChangeWorkspace: vi.fn().mockRejectedValue(error) })

    openWorkspaceCombobox()
    fireEvent.click(screen.getByRole('option', { name: 'Team' }))

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to change workspace:', error)
    })
    consoleError.mockRestore()
  })

  it('stays hidden when only one workspace is available', () => {
    renderWorkspaceSelector({ workspaces: [personalWorkspace] })

    expect(screen.queryByTestId('workspace-selector')).not.toBeInTheDocument()
  })
})
