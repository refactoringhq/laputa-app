export const FOLDER_ROW_CONTENT_INSET = 12
export const FOLDER_ROW_ICON_SIZE = 17
export const FOLDER_ROW_ICON_GAP = 8
export const FOLDER_ROW_NESTING_INDENT = FOLDER_ROW_ICON_SIZE + FOLDER_ROW_ICON_GAP

const FOLDER_CONNECTOR_WIDTH = 1

export function getFolderDepthIndent(depth: number) {
  return depth * FOLDER_ROW_NESTING_INDENT
}

export function getFolderConnectorLeft(depth: number) {
  return FOLDER_ROW_CONTENT_INSET
    + getFolderDepthIndent(depth)
    + FOLDER_ROW_ICON_SIZE / 2
    - FOLDER_CONNECTOR_WIDTH / 2
}
