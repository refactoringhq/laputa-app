import {
  AddBlockButton,
  DragHandleMenu,
  DragHandleButton,
  RemoveBlockItem,
  SideMenu,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  type SideMenuProps,
  useDictionary,
} from '@blocknote/react'

function TolariaDragHandleMenu() {
  const dict = useDictionary()

  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  )
}

export function TolariaSideMenu(props: SideMenuProps) {
  return (
    <SideMenu {...props}>
      <DragHandleButton dragHandleMenu={TolariaDragHandleMenu} />
      <AddBlockButton />
    </SideMenu>
  )
}
