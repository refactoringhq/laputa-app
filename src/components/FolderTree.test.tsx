import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { FolderTree } from './FolderTree'
import { FOLDER_ROW_SINGLE_CLICK_DELAY_MS } from './folder-tree/useFolderRowInteractions'
import { FOLDER_ROW_NESTING_INDENT, getFolderConnectorLeft } from './folder-tree/folderTreeLayout'
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

  it('lets the vault root collapse and expand from the row', () => {
    vi.useFakeTimers()
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        vaultRootPath={vaultRootPath}
      />,
    )

    fireEvent.click(screen.getByTestId('folder-row:'))
    act(() => {
      vi.advanceTimersByTime(FOLDER_ROW_SINGLE_CLICK_DELAY_MS)
    })
    expect(screen.queryByText('projects')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('folder-row:'))
    act(() => {
      vi.advanceTimersByTime(FOLDER_ROW_SINGLE_CLICK_DELAY_MS)
    })
    expect(screen.getByText('projects')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('expands children when clicking a folder row', () => {
    vi.useFakeTimers()
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={vi.fn()} />)
    expect(screen.queryByText('laputa')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('folder-row:projects'))
    act(() => {
      vi.advanceTimersByTime(FOLDER_ROW_SINGLE_CLICK_DELAY_MS)
    })
    expect(screen.getByText('laputa')).toBeInTheDocument()
    expect(screen.getByText('portfolio')).toBeInTheDocument()
    vi.useRealTimers()
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

  it('keeps rename and delete out of row hover actions', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        onDeleteFolder={vi.fn()}
        onRenameFolder={vi.fn().mockResolvedValue(true)}
        onStartRenameFolder={vi.fn()}
        onCancelRenameFolder={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('rename-folder-btn:projects')).not.toBeInTheDocument()
    expect(screen.queryByTestId('delete-folder-btn:projects')).not.toBeInTheDocument()
  })

  it('does not render folder-level disclosure buttons', () => {
    render(<FolderTree folders={mockFolders} selection={defaultSelection} onSelect={vi.fn()} />)

    const leafRowContainer = screen.getByTestId('folder-row:areas').parentElement
    const parentRowContainer = screen.getByTestId('folder-row:projects').parentElement

    expect(leafRowContainer).not.toBeNull()
    expect(parentRowContainer).not.toBeNull()
    expect(within(leafRowContainer as HTMLElement).queryAllByRole('button')).toHaveLength(1)
    expect(within(parentRowContainer as HTMLElement).queryAllByRole('button')).toHaveLength(1)
    expect(screen.queryByLabelText('Expand projects')).not.toBeInTheDocument()
  })

  it('aligns nested folders with the parent folder name and centers connectors on parent icons', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        vaultRootPath={vaultRootPath}
      />,
    )

    expect(screen.getByTestId('folder-row:').parentElement).toHaveStyle({ paddingLeft: '0px' })
    expect(screen.getByTestId('folder-row:projects').parentElement).toHaveStyle({ paddingLeft: `${FOLDER_ROW_NESTING_INDENT}px` })
    expect(screen.getByTestId('folder-connector:')).toHaveStyle({ left: `${getFolderConnectorLeft(0)}px` })
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

  it('dismisses the folder context menu on Escape', () => {
    render(
      <FolderTree
        folders={mockFolders}
        selection={defaultSelection}
        onSelect={vi.fn()}
        onDeleteFolder={vi.fn()}
        onStartRenameFolder={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByText('projects'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('folder-context-menu')).not.toBeInTheDocument()
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
