import { render, screen } from '@testing-library/react'
import type { ComponentType, PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TolariaSideMenu } from './tolariaBlockNoteSideMenu'

let capturedDragHandleMenu: ComponentType | null = null

vi.mock('@blocknote/react', () => ({
  DragHandleMenu: ({ children }: PropsWithChildren) => (
    <div data-testid="drag-handle-menu">{children}</div>
  ),
  RemoveBlockItem: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SideMenu: ({ dragHandleMenu }: { dragHandleMenu?: ComponentType }) => {
    capturedDragHandleMenu = dragHandleMenu ?? null
    return <div data-testid="side-menu" />
  },
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

    const DragHandleMenuComponent = capturedDragHandleMenu!
    render(<DragHandleMenuComponent />)

    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Header row')).toBeInTheDocument()
    expect(screen.getByText('Header column')).toBeInTheDocument()
    expect(screen.queryByText('Colors')).not.toBeInTheDocument()
  })
})
