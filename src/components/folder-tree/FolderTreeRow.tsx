import { memo, useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import type { FolderNode, SidebarSelection } from '../../types'
import { FolderNameInput } from './FolderNameInput'
import { FolderItemRow } from './FolderItemRow'
import { translate, type AppLocale } from '../../lib/i18n'

interface FolderTreeRowProps {
  depth: number
  expanded: Record<string, boolean>
  node: FolderNode
  onDeleteFolder?: (folderPath: string) => void
  creatingChildParentPath?: string | null
  onCancelCreateChildFolder?: () => void
  onCreateChildFolder?: (parentPath: string, value: string) => Promise<boolean> | boolean
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onSelect: (selection: SidebarSelection) => void
  onStartRenameFolder?: (folderPath: string) => void
  onToggle: (path: string) => void
  onCancelRenameFolder?: () => void
  locale?: AppLocale
  renamingFolderPath?: string | null
  selection: SidebarSelection
}

function FolderRenameRow({
  contentInset,
  depthIndent,
  node,
  locale,
  onCancelRenameFolder,
  onRenameFolder,
}: {
  contentInset: number
  depthIndent: number
  node: FolderNode
  locale: AppLocale
  onCancelRenameFolder: () => void
  onRenameFolder: (folderPath: string, nextName: string) => Promise<boolean> | boolean
}) {
  return (
    <div style={{ paddingLeft: depthIndent }}>
      <FolderNameInput
        ariaLabel={translate(locale, 'sidebar.folder.name')}
        initialValue={node.name}
        placeholder={translate(locale, 'sidebar.folder.name')}
        leftInset={contentInset}
        selectTextOnFocus={true}
        testId="rename-folder-input"
        onCancel={onCancelRenameFolder}
        onSubmit={(nextName) => onRenameFolder(node.path, nextName)}
      />
    </div>
  )
}

function FolderChildren({
  depth,
  expanded,
  node,
  onDeleteFolder,
  creatingChildParentPath,
  onCancelCreateChildFolder,
  onCreateChildFolder,
  onOpenMenu,
  onRenameFolder,
  onSelect,
  onStartRenameFolder,
  onToggle,
  onCancelRenameFolder,
  locale,
  renamingFolderPath,
  selection,
}: FolderTreeRowProps) {
  const isExpanded = expanded[node.path] ?? false
  const hasChildren = node.children.length > 0
  if (!isExpanded || !hasChildren) return null

  return (
    <div className="relative" style={{ paddingLeft: 15 }}>
      <div
        className="absolute top-0 bottom-0 bg-border"
        style={{ left: 15 + depth * 16, width: 1, opacity: 0.3 }}
      />
      {node.children.map((child) => (
        <FolderTreeRow
          key={child.path}
          depth={depth + 1}
          expanded={expanded}
          node={child}
          onDeleteFolder={onDeleteFolder}
          creatingChildParentPath={creatingChildParentPath}
          onCancelCreateChildFolder={onCancelCreateChildFolder}
          onCreateChildFolder={onCreateChildFolder}
          onOpenMenu={onOpenMenu}
          onRenameFolder={onRenameFolder}
          onSelect={onSelect}
          onStartRenameFolder={onStartRenameFolder}
          onToggle={onToggle}
          onCancelRenameFolder={onCancelRenameFolder}
          locale={locale}
          renamingFolderPath={renamingFolderPath}
          selection={selection}
        />
      ))}
    </div>
  )
}

export const FolderTreeRow = memo(function FolderTreeRow({
  depth,
  expanded,
  node,
  onDeleteFolder,
  creatingChildParentPath,
  onCancelCreateChildFolder,
  onCreateChildFolder,
  onOpenMenu,
  onRenameFolder,
  onSelect,
  onStartRenameFolder,
  onToggle,
  onCancelRenameFolder,
  locale = 'en',
  renamingFolderPath,
  selection,
}: FolderTreeRowProps) {
  const isExpanded = expanded[node.path] ?? false
  const isRenaming = renamingFolderPath === node.path
  const isSelected = selection.kind === 'folder' && selection.path === node.path
  const depthIndent = depth * 16
  const contentInset = 16
  const isCreatingChild = creatingChildParentPath === node.path
  const selectFolder = useCallback(() => {
    onSelect({ kind: 'folder', path: node.path })
  }, [node.path, onSelect])
  const row = (
    <FolderItemRow
      contentInset={contentInset}
      depthIndent={depthIndent}
      isExpanded={isExpanded}
      isSelected={isSelected}
      node={node}
      onDeleteFolder={onDeleteFolder}
      onOpenMenu={onOpenMenu}
      onSelect={selectFolder}
      onStartRenameFolder={onStartRenameFolder}
      onToggle={onToggle}
      locale={locale}
    />
  )

  return (
    <>
      {isRenaming && onRenameFolder && onCancelRenameFolder ? (
        <FolderRenameRow
          contentInset={contentInset}
          depthIndent={depthIndent}
          node={node}
          locale={locale}
          onCancelRenameFolder={onCancelRenameFolder}
          onRenameFolder={onRenameFolder}
        />
      ) : row}
      {isCreatingChild && onCreateChildFolder && onCancelCreateChildFolder && (
        <div style={{ paddingLeft: (depth + 1) * 16 + 15 }}>
          <FolderNameInput
            ariaLabel={translate(locale, 'sidebar.folder.newName')}
            initialValue=""
            placeholder={translate(locale, 'sidebar.folder.name')}
            submitOnBlur={true}
            testId={`new-child-folder-input:${node.path}`}
            onCancel={onCancelCreateChildFolder}
            onSubmit={(value) => onCreateChildFolder(node.path, value)}
          />
        </div>
      )}
      <FolderChildren
        depth={depth}
        expanded={expanded}
        node={node}
        onDeleteFolder={onDeleteFolder}
        creatingChildParentPath={creatingChildParentPath}
        onCancelCreateChildFolder={onCancelCreateChildFolder}
        onCreateChildFolder={onCreateChildFolder}
        onOpenMenu={onOpenMenu}
        onRenameFolder={onRenameFolder}
        onSelect={onSelect}
        onStartRenameFolder={onStartRenameFolder}
        onToggle={onToggle}
        onCancelRenameFolder={onCancelRenameFolder}
        locale={locale}
        renamingFolderPath={renamingFolderPath}
        selection={selection}
      />
    </>
  )
})
