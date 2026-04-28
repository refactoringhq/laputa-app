import { render, screen } from '@testing-library/react'
import type { ComponentType, PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TolariaSideMenu } from './tolariaBlockNoteSideMenu'

let capturedDragHandleMenu: ComponentType | null = null

vi.mock('@blocknote/react', () => ({
  AddBlockButton: () => <button type="button">Add block</button>,
  DragHandleMenu: ({ children }: PropsWithChildren) => (
    <div data-testid="drag-handle-menu">{children}</div>
  ),
  DragHandleButton: ({ dragHandleMenu }: { dragHandleMenu?: ComponentType }) => {
    capturedDragHandleMenu = dragHandleMenu ?? null
    return (
      <button type="button" draggable>
        Open block menu
      </button>
    )
  },
  RemoveBlockItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SideMenu: ({ children }: PropsWithChildren) => <div data-testid="side-menu">{children}</div>,
  TableColumnHeaderItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
  TableRowHeaderItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
  useDictionary: () => ({
    drag_handle: {
      delete_menuitem: 'Delete',
      header_row_menuitem: 'Header row',
      header_column_menuitem: 'Header column',
      colors_menuitem: 'Colors',
    },
  }),
}))

describe('TolariaSideMenu', () => {
  it('replaces BlockNote block colors with markdown-safe drag-handle items', () => {
    render(<TolariaSideMenu />)

    expect(screen.getByTestId('side-menu')).toBeInTheDocument()
    expect(capturedDragHandleMenu).not.toBeNull()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Open block menu',
      'Add block',
    ])

    const DragHandleMenuComponent = capturedDragHandleMenu!
    render(<DragHandleMenuComponent />)

    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Header row')).toBeInTheDocument()
    expect(screen.getByText('Header column')).toBeInTheDocument()
    expect(screen.queryByText('Colors')).not.toBeInTheDocument()
  })
})
