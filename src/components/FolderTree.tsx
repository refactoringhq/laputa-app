import {
  memo,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useMemo,
} from 'react'
import {
  Plus,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import type { FolderNode, SidebarSelection } from '../types'
import { FolderContextMenu } from './folder-tree/FolderContextMenu'
import { FolderNameInput } from './folder-tree/FolderNameInput'
import { FolderTreeRow } from './folder-tree/FolderTreeRow'
import { useFolderContextMenu } from './folder-tree/useFolderContextMenu'
import { useFolderTreeDisclosure } from './folder-tree/useFolderTreeDisclosure'
import { SidebarGroupHeader } from './sidebar/SidebarGroupHeader'
import { translate, type AppLocale } from '../lib/i18n'
import type { FolderFileActions } from '../hooks/useFileActions'

interface FolderTreeProps {
  folders: FolderNode[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onCreateFolder?: (name: string) => Promise<boolean> | boolean
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  renamingFolderPath?: string | null
  onStartRenameFolder?: (folderPath: string) => void
  onCancelRenameFolder?: () => void
  collapsed?: boolean
  locale?: AppLocale
  onToggle?: () => void
  vaultRootPath?: string
}

interface FolderTreeBodyProps extends Pick<
  FolderTreeProps,
  | 'locale'
  | 'onCancelRenameFolder'
  | 'onDeleteFolder'
  | 'onRenameFolder'
  | 'onSelect'
  | 'onStartRenameFolder'
  | 'renamingFolderPath'
  | 'selection'
> {
  displayedExpanded: Record<string, boolean>
  displayedFolders: FolderNode[]
  isCreating: boolean
  onCancelCreateFolder: () => void
  onCreateFolderSubmit: (value: string) => Promise<boolean>
  rootPath?: string
  sectionCollapsed: boolean
  toggleFolder: (path: string) => void
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => void
}

function vaultRootLabel(vaultRootPath: string, locale: AppLocale): string {
  const trimmed = vaultRootPath.trim().replace(/[\\/]+$/g, '')
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || translate(locale, 'status.vault.default')
}

function buildRootNode(folders: FolderNode[], vaultRootPath: string | undefined, locale: AppLocale): FolderNode | null {
  if (!vaultRootPath?.trim()) return null
  return {
    name: vaultRootLabel(vaultRootPath, locale),
    path: '',
    children: folders,
  }
}

function useDisplayedFolders(folders: FolderNode[], expanded: Record<string, boolean>, vaultRootPath: string | undefined, locale: AppLocale) {
  return useMemo(() => {
    const rootNode = buildRootNode(folders, vaultRootPath, locale)
    return {
      displayedExpanded: rootNode ? { '': true, ...expanded } : expanded,
      displayedFolders: rootNode ? [rootNode] : folders,
    }
  }, [expanded, folders, locale, vaultRootPath])
}

export const FolderTree = memo(function FolderTree({
  folders,
  selection,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  folderFileActions,
  renamingFolderPath,
  onStartRenameFolder,
  onCancelRenameFolder,
  collapsed: externalCollapsed,
  locale = 'en',
  onToggle,
  vaultRootPath,
}: FolderTreeProps) {
  const {
    closeCreateForm,
    expanded,
    handleToggleSection,
    isCreating,
    openCreateForm,
    sectionCollapsed,
    toggleFolder,
  } = useFolderTreeDisclosure({
    collapsed: externalCollapsed,
    onToggle,
    renamingFolderPath,
    selection,
  })
  const {
    closeContextMenu,
    contextMenu,
    handleCopyPathFromMenu,
    handleDeleteFromMenu,
    handleOpenMenu,
    handleRevealFromMenu,
    handleRenameFromMenu,
    menuRef,
  } = useFolderContextMenu({
    onDeleteFolder,
    folderFileActions,
    onStartRenameFolder,
  })

  const handleCreateFolderSubmit = useCallback(async (value: string) => {
    const nextName = value.trim()
    if (!nextName || !onCreateFolder) {
      closeCreateForm()
      return true
    }

    const created = await onCreateFolder(nextName)
    if (created) closeCreateForm()
    return created
  }, [closeCreateForm, onCreateFolder])

  const handleCreateFolderClick = useCallback(() => {
    closeContextMenu()
    openCreateForm()
  }, [closeContextMenu, openCreateForm])

  const { displayedExpanded, displayedFolders } = useDisplayedFolders(folders, expanded, vaultRootPath, locale)

  if (displayedFolders.length === 0 && !isCreating) return null

  return (
    <div className="border-b border-border" style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label={translate(locale, 'sidebar.group.folders')} collapsed={sectionCollapsed} onToggle={handleToggleSection}>
        {onCreateFolder && (
          <CreateFolderButton locale={locale} onCreate={handleCreateFolderClick} />
        )}
      </SidebarGroupHeader>
      <FolderTreeBody
        displayedExpanded={displayedExpanded}
        displayedFolders={displayedFolders}
        isCreating={isCreating}
        locale={locale}
        onCancelCreateFolder={closeCreateForm}
        onCancelRenameFolder={onCancelRenameFolder}
        onCreateFolderSubmit={handleCreateFolderSubmit}
        onDeleteFolder={onDeleteFolder}
        onOpenMenu={handleOpenMenu}
        onRenameFolder={onRenameFolder}
        onSelect={onSelect}
        onStartRenameFolder={onStartRenameFolder}
        renamingFolderPath={renamingFolderPath}
        rootPath={vaultRootPath}
        sectionCollapsed={sectionCollapsed}
        selection={selection}
        toggleFolder={toggleFolder}
      />
      <FolderContextMenu
        menu={contextMenu}
        menuRef={menuRef}
        onDelete={handleDeleteFromMenu}
        onReveal={handleRevealFromMenu}
        onCopyPath={handleCopyPathFromMenu}
        onRename={handleRenameFromMenu}
        locale={locale}
      />
    </div>
  )
})

function FolderTreeBody({
  displayedExpanded,
  displayedFolders,
  isCreating,
  locale = 'en',
  onCancelCreateFolder,
  onCancelRenameFolder,
  onCreateFolderSubmit,
  onDeleteFolder,
  onOpenMenu,
  onRenameFolder,
  onSelect,
  onStartRenameFolder,
  renamingFolderPath,
  rootPath,
  sectionCollapsed,
  selection,
  toggleFolder,
}: FolderTreeBodyProps) {
  if (sectionCollapsed) return null

  return (
    <div className="flex flex-col gap-0.5 pb-2">
      {displayedFolders.map((node) => (
        <FolderTreeRow
          key={node.path}
          depth={0}
          expanded={displayedExpanded}
          node={node}
          onDeleteFolder={onDeleteFolder}
          onOpenMenu={onOpenMenu}
          onRenameFolder={onRenameFolder}
          onSelect={onSelect}
          onStartRenameFolder={onStartRenameFolder}
          onToggle={toggleFolder}
          onCancelRenameFolder={onCancelRenameFolder}
          locale={locale}
          renamingFolderPath={renamingFolderPath}
          rootPath={rootPath}
          selection={selection}
        />
      ))}
      {isCreating && (
        <div style={{ paddingLeft: 8 }}>
          <FolderNameInput
            ariaLabel={translate(locale, 'sidebar.folder.newName')}
            initialValue=""
            placeholder={translate(locale, 'sidebar.folder.name')}
            submitOnBlur={true}
            testId="new-folder-input"
            onCancel={onCancelCreateFolder}
            onSubmit={onCreateFolderSubmit}
          />
        </div>
      )}
    </div>
  )
}

function CreateFolderButton({
  locale,
  onCreate,
}: {
  locale: AppLocale
  onCreate: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="h-auto w-auto min-w-0 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
      data-testid="create-folder-btn"
      title={translate(locale, 'sidebar.action.createFolder')}
      aria-label={translate(locale, 'sidebar.action.createFolder')}
      onClick={(event) => {
        event.stopPropagation()
        onCreate()
      }}
    >
      <Plus size={12} className="text-muted-foreground hover:text-foreground" />
    </Button>
  )
}
