import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GitSetupDialog } from './GitRequiredModal'

describe('GitSetupDialog', () => {
  it('renders title and explanation', () => {
    render(<GitSetupDialog open onInitGit={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Enable Git for this vault?')).toBeInTheDocument()
    expect(screen.getByText(/You can keep using this vault without Git/)).toBeInTheDocument()
  })

  it('renders both action buttons', () => {
    render(<GitSetupDialog open onInitGit={vi.fn()} onDismiss={vi.fn()} />)
    expect(screen.getByText('Initialize Git')).toBeInTheDocument()
    expect(screen.getByText('Not now')).toBeInTheDocument()
  })

  it('calls onInitGit when primary button clicked', async () => {
    const onInitGit = vi.fn().mockResolvedValue(undefined)
    render(<GitSetupDialog open onInitGit={onInitGit} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByText('Initialize Git'))
    expect(onInitGit).toHaveBeenCalledOnce()
  })

  it('calls onDismiss when secondary button clicked', () => {
    const onDismiss = vi.fn()
    render(<GitSetupDialog open onInitGit={vi.fn()} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Not now'))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('disables buttons and shows spinner while creating', async () => {
    let resolve: () => void
    const onInitGit = vi.fn().mockReturnValue(new Promise<void>(r => { resolve = r }))
    render(<GitSetupDialog open onInitGit={onInitGit} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByText('Initialize Git'))
    await waitFor(() => {
      expect(screen.getByText('Initializing…')).toBeInTheDocument()
    })
    resolve!()
  })

  it('shows error message when creation fails', async () => {
    const onInitGit = vi.fn().mockRejectedValue(new Error('Permission denied'))
    render(<GitSetupDialog open onInitGit={onInitGit} onDismiss={vi.fn()} />)
    fireEvent.click(screen.getByText('Initialize Git'))
    await waitFor(() => {
      expect(screen.getByText(/Permission denied/)).toBeInTheDocument()
    })
  })

  it('closes on Escape without initializing Git', () => {
    const onDismiss = vi.fn()
    const onInitGit = vi.fn()
    render(<GitSetupDialog open onInitGit={onInitGit} onDismiss={onDismiss} />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(onInitGit).not.toHaveBeenCalled()
  })
})
