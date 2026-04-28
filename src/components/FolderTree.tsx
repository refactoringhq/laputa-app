import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
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

type CreateFolderHandler = (name: string, parentPath?: string | null) => Promise<boolean> | boolean

interface FolderTreeProps {
  folders: FolderNode[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  onCreateFolder?: CreateFolderHandler
  onRenameFolder?: (folderPath: string, nextName: string) => Promise<boolean> | boolean
  onDeleteFolder?: (folderPath: string) => void
  folderFileActions?: FolderFileActions
  renamingFolderPath?: string | null
  onStartRenameFolder?: (folderPath: string) => void
  onCancelRenameFolder?: () => void
  collapsed?: boolean
  createRequestKey?: number
  locale?: AppLocale
  onToggle?: () => void
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
  createRequestKey = 0,
  locale = 'en',
  onToggle,
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
  const [creatingChildParentPath, setCreatingChildParentPath] = useState<string | null>(null)
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

  const handleCreateChildFolderSubmit = useCallback(async (parentPath: string, value: string) => {
    const nextName = value.trim()
    if (!nextName || !onCreateFolder) {
      setCreatingChildParentPath(null)
      return true
    }

    const created = await onCreateFolder(nextName, parentPath)
    if (created) setCreatingChildParentPath(null)
    return created
  }, [onCreateFolder])

  const handleCreateChildFolderFromMenu = useCallback((folderPath: string) => {
    closeContextMenu()
    setCreatingChildParentPath(folderPath)
    if (!expanded[folderPath]) toggleFolder(folderPath)
  }, [closeContextMenu, expanded, toggleFolder])

  const handleCreateFolderClick = useCallback(() => {
    closeContextMenu()
    setCreatingChildParentPath(null)
    openCreateForm()
  }, [closeContextMenu, openCreateForm])
  const lastCreateRequestKey = useRef(createRequestKey)

  useEffect(() => {
    if (createRequestKey === lastCreateRequestKey.current) return
    lastCreateRequestKey.current = createRequestKey
    const timeoutId = window.setTimeout(handleCreateFolderClick, 0)
    return () => window.clearTimeout(timeoutId)
  }, [createRequestKey, handleCreateFolderClick])

  if (folders.length === 0 && !isCreating) return null

  return (
    <div className="border-b border-border" style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label={translate(locale, 'sidebar.group.folders')} collapsed={sectionCollapsed} onToggle={handleToggleSection}>
        {onCreateFolder && (
          <CreateFolderButton locale={locale} onCreate={handleCreateFolderClick} />
        )}
      </SidebarGroupHeader>
      {!sectionCollapsed && (
        <div className="flex flex-col gap-0.5 pb-2">
          {folders.map((node) => (
            <FolderTreeRow
              key={node.path}
              depth={0}
              expanded={expanded}
              node={node}
              onDeleteFolder={onDeleteFolder}
              onOpenMenu={handleOpenMenu}
              onRenameFolder={onRenameFolder}
              onSelect={onSelect}
              onStartRenameFolder={onStartRenameFolder}
              onToggle={toggleFolder}
              onCancelRenameFolder={onCancelRenameFolder}
              creatingChildParentPath={creatingChildParentPath}
              onCancelCreateChildFolder={() => setCreatingChildParentPath(null)}
              onCreateChildFolder={handleCreateChildFolderSubmit}
              locale={locale}
              renamingFolderPath={renamingFolderPath}
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
                onCancel={closeCreateForm}
                onSubmit={handleCreateFolderSubmit}
              />
            </div>
          )}
        </div>
      )}
      <FolderContextMenu
        menu={contextMenu}
        menuRef={menuRef}
        onDelete={handleDeleteFromMenu}
        onReveal={handleRevealFromMenu}
        onCopyPath={handleCopyPathFromMenu}
        onCreateSubfolder={onCreateFolder ? handleCreateChildFolderFromMenu : undefined}
        onRename={handleRenameFromMenu}
        locale={locale}
      />
    </div>
  )
})

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
