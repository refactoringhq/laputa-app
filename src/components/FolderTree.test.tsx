import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FolderTree } from './FolderTree'
import { FOLDER_ROW_SINGLE_CLICK_DELAY_MS } from './folder-tree/useFolderRowInteractions'
import type { FolderNode, SidebarSelection } from '../types'

const mockFolders: FolderNode[] = [
  {
    name: 'projects',
    path: 'projects',
    children: [
      { name: 'laputa', path: 'projects/laputa', children: [] },
      { name: 'portfolio', path: 'projects/portfolio', children: [] },
    ],
  },
  { name: 'areas', path: 'areas', children: [] },
  { name: 'journal', path: 'journal', children: [] },
]

const defaultSelection: SidebarSelection = { kind: 'filter', filter: 'all' }
const vaultRootPath = '/Users/luca/Laputa'

describe('FolderTree', () => {
  it('renders nothing when folders is empty', () => {
    const { container } = render(
      <FolderTree folders={[]} selection={defaultSelection} onSelect={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders FOLDERS header and top-level folders', () => {
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={vi.fn()} />)
    expect(screen.getByText('FOLDERS')).toBeInTheDocument()
    expect(screen.getByText('projects')).toBeInTheDocument()
    expect(screen.getByText('areas')).toBeInTheDocument()
    expect(screen.getByText('journal')).toBeInTheDocument()
  })

  it('renders the vault root as the top-level folder when a vault path is available', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        vaultRootPath={vaultRootPath}
      />,
    )

    expect(screen.getByText('Laputa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Laputa' })).toBeInTheDocument()
    expect(screen.getByText('projects')).toBeInTheDocument()
    expect(screen.getByText('areas')).toBeInTheDocument()
    expect(screen.getByText('journal')).toBeInTheDocument()
  })

  it('renders the vault root even when the vault has no subfolders', () => {
    render(
      <FolderTree
        folders={[]}
        selection={defaultSelection}
        onSelect={vi.fn()}
        vaultRootPath={vaultRootPath}
      />,
    )

    expect(screen.getByText('Laputa')).toBeInTheDocument()
  })

  it('lets the vault root collapse and expand its nested folders', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        vaultRootPath={vaultRootPath}
      />,
    )

    fireEvent.click(screen.getByLabelText('Collapse Laputa'))
    expect(screen.queryByText('projects')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Expand Laputa'))
    expect(screen.getByText('projects')).toBeInTheDocument()
  })

  it('expands children when clicking the folder chevron', () => {
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={vi.fn()} />)
    expect(screen.queryByText('laputa')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Expand projects'))
    expect(screen.getByText('laputa')).toBeInTheDocument()
    expect(screen.getByText('portfolio')).toBeInTheDocument()
  })

  it('calls onSelect with folder kind when clicking a folder row', () => {
    const onSelect = vi.fn()
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('folder-row:projects'))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', path: 'projects' })
  })

  it('selects the vault root with the root path attached', () => {
    const onSelect = vi.fn()
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={onSelect}
        vaultRootPath={vaultRootPath}
      />,
    )

    fireEvent.click(screen.getByTestId('folder-row:'))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'folder', path: '', rootPath: vaultRootPath })
  })

  it('expands children when single-clicking a folder row with children', () => {
    vi.useFakeTimers()
    function FolderTreeHarness() {
      const [selection, setSelection] = useState<SidebarSelection>(defaultSelection)
      return <FolderTree folders={mockFolders} selection={selection} onSelect={setSelection} />
    }

    render(<FolderTreeHarness />)

    fireEvent.click(screen.getByTestId('folder-row:projects'))
    act(() => {
      vi.advanceTimersByTime(FOLDER_ROW_SINGLE_CLICK_DELAY_MS)
    })

    expect(screen.getByText('laputa')).toBeInTheDocument()
    expect(screen.getByText('portfolio')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('folder-row:projects'))
    act(() => {
      vi.advanceTimersByTime(FOLDER_ROW_SINGLE_CLICK_DELAY_MS)
    })

    expect(screen.queryByText('laputa')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('collapses section when clicking the FOLDERS header', () => {
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={vi.fn()} />)
    expect(screen.getByText('projects')).toBeInTheDocument()
    fireEvent.click(screen.getByText('FOLDERS'))
    expect(screen.queryByText('projects')).not.toBeInTheDocument()
  })

  it('highlights the selected folder row', () => {
    const selection: SidebarSelection = { kind: 'folder', path: 'areas' }
    render(<FolderTree folders={mockFolders} selection={selection} onSelect={vi.fn()} />)
    expect(screen.getByTestId('folder-row:areas').className).toContain('text-primary')
  })

  it('opens the create-folder input from the header action', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        onCreateFolder={vi.fn().mockResolvedValue(true)}
      />,
    )
    fireEvent.click(screen.getByTestId('create-folder-btn'))
    expect(screen.getByTestId('new-folder-input')).toBeInTheDocument()
  })

  it('starts rename on folder double-click', () => {
    const onStartRenameFolder = vi.fn()
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        onStartRenameFolder={onStartRenameFolder}
        onCancelRenameFolder={vi.fn()}
      />,
    )
    fireEvent.doubleClick(screen.getByTestId('folder-row:projects'))
    expect(onStartRenameFolder).toHaveBeenCalledWith('projects')
  })

  it('shows inline rename and delete actions for folders', () => {
    const onDeleteFolder = vi.fn()
    const onStartRenameFolder = vi.fn()
    const onSelect = vi.fn()
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={onSelect}
        onDeleteFolder={onDeleteFolder}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        onStartRenameFolder={onStartRenameFolder}
        onCancelRenameFolder={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('rename-folder-btn:projects'))
    fireEvent.click(screen.getByTestId('delete-folder-btn:projects'))

    expect(onSelect).toHaveBeenNthCalledWith(1, { kind: 'folder', path: 'projects' })
    expect(onStartRenameFolder).toHaveBeenCalledWith('projects')
    expect(onSelect).toHaveBeenNthCalledWith(2, { kind: 'folder', path: 'projects' })
    expect(onDeleteFolder).toHaveBeenCalledWith('projects')
  })

  it('does not reserve a disclosure slot for leaf folders', () => {
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={vi.fn()} />)

    const leafRowContainer = screen.getByTestId('folder-row:areas').parentElement
    const parentRowContainer = screen.getByTestId('folder-row:projects').parentElement

    expect(leafRowContainer).not.toBeNull()
    expect(parentRowContainer).not.toBeNull()
    expect(within(leafRowContainer as HTMLElement).queryAllByRole('button')).toHaveLength(1)
    expect(within(parentRowContainer as HTMLElement).queryAllByRole('button')).toHaveLength(2)
  })

  it('shows the rename input when a folder is being renamed', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={{ kind: 'folder', path: 'areas' }}
        onSelect={vi.fn()}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        renamingFolderPath="areas"
        onCancelRenameFolder={vi.fn()}
      />,
    )
    expect(screen.getByTestId('rename-folder-input')).toBeInTheDocument()
  })

  it('keeps folder toggling healthy after cancelling rename', () => {
    vi.useFakeTimers()
    const onCancelRenameFolder = vi.fn()
    const { rerender } = render(
      <FolderTree
        folders={mockFolders}
        selection={{ kind: 'folder', path: 'projects' }}
        onSelect={vi.fn()}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        renamingFolderPath="projects"
        onCancelRenameFolder={onCancelRenameFolder}
      />,
    )

    fireEvent.keyDown(screen.getByTestId('rename-folder-input'), { key: 'Escape' })
    expect(onCancelRenameFolder).toHaveBeenCalledTimes(1)

    rerender(
      <FolderTree
        folders={mockFolders}
        selection={{ kind: 'folder', path: 'projects' }}
        onSelect={vi.fn()}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        onCancelRenameFolder={onCancelRenameFolder}
      />,
    )

    const wasExpanded = screen.queryByText('laputa') !== null
    fireEvent.click(screen.getByTestId('folder-row:projects'))
    act(() => {
      vi.advanceTimersByTime(FOLDER_ROW_SINGLE_CLICK_DELAY_MS)
    })

    expect(screen.queryByText('laputa') !== null).toBe(!wasExpanded)
    vi.useRealTimers()
  })

  it('opens a context menu with a delete action on right-click', () => {
    const onDeleteFolder = vi.fn()
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        onDeleteFolder={onDeleteFolder}
        onStartRenameFolder={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByText('projects'))
    expect(screen.getByTestId('folder-context-menu')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('delete-folder-menu-item'))
    expect(onDeleteFolder).toHaveBeenCalledWith('projects')
  })

  it('opens folder file actions from the context menu', () => {
    const onRevealFolder = vi.fn()
    const onCopyFolderPath = vi.fn()
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        folderFileActions={{
          copyFolderPath: onCopyFolderPath,
          revealFolder: onRevealFolder,
        }}
        onStartRenameFolder={vi.fn()}
      />,
    )

    fireEvent.contextMenu(screen.getByText('projects'))
    fireEvent.click(screen.getByTestId('reveal-folder-menu-item'))
    expect(onRevealFolder).toHaveBeenCalledWith('projects')

    fireEvent.contextMenu(screen.getByText('projects'))
    fireEvent.click(screen.getByTestId('copy-folder-path-menu-item'))
    expect(onCopyFolderPath).toHaveBeenCalledWith('projects')
  })

  it('keeps destructive folder actions off the vault root row and menu', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        folderFileActions={{
          copyFolderPath: vi.fn(),
          revealFolder: vi.fn(),
        }}
        onDeleteFolder={vi.fn()}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        onStartRenameFolder={vi.fn()}
        onCancelRenameFolder={vi.fn()}
        vaultRootPath={vaultRootPath}
      />,
    )

    expect(screen.queryByTestId('rename-folder-btn:')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-folder-btn:')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByText('Laputa'))

    expect(screen.getByTestId('reveal-folder-menu-item')).toBeInTheDocument()
    expect(screen.getByTestId('copy-folder-path-menu-item')).toBeInTheDocument()
    expect(screen.queryByText('Rename folder...')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-folder-menu-item')).not.toBeInTheDocument()
  })
})
