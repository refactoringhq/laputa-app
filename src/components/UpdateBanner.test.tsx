import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'
import type { UpdateStatus, UpdateActions } from '../hooks/useUpdater'

// Mock restartApp to prevent dynamic import issues in tests
vi.mock('../hooks/useUpdater', async () => {
  const actual = await vi.importActual('../hooks/useUpdater')
  return {
    ...actual,
    restartApp: vi.fn(),
  }
})

function makeActions(overrides?: Partial<UpdateActions>): UpdateActions {
  return {
    startDownload: vi.fn(),
    openReleaseNotes: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  }
}

function makeAvailableStatus(overrides?: Partial<Extract<UpdateStatus, { state: 'available' }>>): UpdateStatus {
  return {
    state: 'available',
    version: '2026.4.16',
    displayVersion: '2026.4.16',
    notes: undefined,
    ...overrides,
  }
}

function makeDownloadingStatus(overrides?: Partial<Extract<UpdateStatus, { state: 'downloading' }>>): UpdateStatus {
  return {
    state: 'downloading',
    version: '2026.4.16-alpha.3',
    displayVersion: 'Alpha 2026.4.16.3',
    progress: 0.65,
    ...overrides,
  }
}

function makeReadyStatus(overrides?: Partial<Extract<UpdateStatus, { state: 'ready' }>>): UpdateStatus {
  return {
    state: 'ready',
    version: '2026.4.16',
    displayVersion: '2026.4.16',
    ...overrides,
  }
}

function renderBanner(status: UpdateStatus, actions = makeActions(), locale: 'en' | 'zh-CN' = 'en') {
  const view = render(<UpdateBanner status={status} actions={actions} locale={locale} />)
  return { ...view, actions }
}

describe('UpdateBanner', () => {
  it('renders nothing when idle', () => {
    const status: UpdateStatus = { state: 'idle' }
    const { container } = renderBanner(status)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing on error state', () => {
    const status: UpdateStatus = { state: 'error' }
    const { container } = renderBanner(status)
    expect(container.innerHTML).toBe('')
  })

  it('shows version and action buttons when update is available', () => {
    renderBanner(makeAvailableStatus({
      version: '2026.4.16-alpha.3',
      displayVersion: 'Alpha 2026.4.16.3',
      notes: 'Bug fixes',
    }))

    expect(screen.getByTestId('update-banner')).toBeTruthy()
    expect(screen.getByText(/Tolaria Alpha 2026\.4\.16\.3/)).toBeTruthy()
    expect(screen.getByText(/is available/)).toBeTruthy()
    expect(screen.getByTestId('update-now-btn')).toBeTruthy()
    expect(screen.getByTestId('update-release-notes')).toBeTruthy()
    expect(screen.getByTestId('update-dismiss')).toBeTruthy()
  })

  it('localizes available update copy', () => {
    renderBanner(makeAvailableStatus({
      version: '2026.4.16-alpha.3',
      displayVersion: 'Alpha 2026.4.16.3',
    }), makeActions(), 'zh-CN')

    expect(screen.getByText(/Tolaria Alpha 2026\.4\.16\.3/)).toBeTruthy()
    expect(screen.getByText(/可用/)).toBeTruthy()
    expect(screen.getByTestId('update-release-notes')).toHaveTextContent('发行说明')
    expect(screen.getByTestId('update-now-btn')).toHaveTextContent('立即更新')
    expect(screen.getByTestId('update-dismiss')).toHaveAttribute('aria-label', '关闭')
  })

  it('"Update Now" calls startDownload', () => {
    const { actions } = renderBanner(makeAvailableStatus())

    fireEvent.click(screen.getByTestId('update-now-btn'))
    expect(actions.startDownload).toHaveBeenCalledOnce()
  })

  it('"Release Notes" link calls openReleaseNotes', () => {
    const { actions } = renderBanner(makeAvailableStatus())

    fireEvent.click(screen.getByTestId('update-release-notes'))
    expect(actions.openReleaseNotes).toHaveBeenCalledOnce()
  })

  it('dismiss button calls dismiss action', () => {
    const { actions } = renderBanner(makeAvailableStatus())

    fireEvent.click(screen.getByTestId('update-dismiss'))
    expect(actions.dismiss).toHaveBeenCalledOnce()
  })

  it('shows progress bar during download', () => {
    renderBanner(makeDownloadingStatus())

    expect(screen.getByText(/Downloading Tolaria Alpha 2026\.4\.16\.3/)).toBeTruthy()
    expect(screen.getByText('65%')).toBeTruthy()

    const progressBar = screen.getByTestId('update-progress')
    expect(progressBar.style.width).toBe('65%')
  })

  it('shows 0% at start of download', () => {
    renderBanner(makeDownloadingStatus({
      version: '2026.4.16',
      displayVersion: '2026.4.16',
      progress: 0,
    }))

    expect(screen.getByText('0%')).toBeTruthy()
    const progressBar = screen.getByTestId('update-progress')
    expect(progressBar.style.width).toBe('0%')
  })

  it('shows restart button when update is ready', () => {
    renderBanner(makeReadyStatus())

    expect(screen.getByText(/Tolaria 2026\.4\.16/)).toBeTruthy()
    expect(screen.getByText(/restart to apply/)).toBeTruthy()
    expect(screen.getByTestId('update-restart-btn')).toBeTruthy()
  })

  it('restart button calls restartApp', async () => {
    const { restartApp } = await import('../hooks/useUpdater')
    renderBanner(makeReadyStatus())

    fireEvent.click(screen.getByTestId('update-restart-btn'))
    expect(restartApp).toHaveBeenCalled()
  })
})
