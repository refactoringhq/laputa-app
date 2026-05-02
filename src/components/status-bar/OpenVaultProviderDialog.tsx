import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../../lib/i18n'
import type { VaultProviderType, VaultProviderValidationResult } from '../../lib/vaultProviders'
import { FolderOpen, Cloud } from 'lucide-react'

interface OpenVaultProviderDialogProps {
  open: boolean
  validationResult: VaultProviderValidationResult | null
  validationMessage: string | null
  inferredProvider: VaultProviderType | null
  onSelect: (provider: VaultProviderType) => void
  onCancel: () => void
  locale?: AppLocale
}

export function OpenVaultProviderDialog({
  open,
  validationResult,
  validationMessage,
  inferredProvider,
  onSelect,
  onCancel,
  locale = 'en',
}: OpenVaultProviderDialogProps) {
  if (validationResult === 'invalid') {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{translate(locale, 'status.vault.provider.invalid.title')}</DialogTitle>
            <DialogDescription>
              {validationMessage || translate(locale, 'status.vault.provider.invalid.message')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (validationResult === 'warning') {
    return (
      <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
        <DialogContent className="max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{translate(locale, 'status.vault.provider.warning.title')}</DialogTitle>
            <DialogDescription>
              {validationMessage || translate(locale, 'status.vault.provider.warning.localInIcloud')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button variant="default" onClick={() => onSelect('local-folder')}>
              Use Local Folder
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{translate(locale, 'status.vault.provider.select.title')}</DialogTitle>
          <DialogDescription>
            {translate(locale, 'status.vault.provider.select.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-4">
          <Button
            variant="outline"
            className={`h-auto justify-start px-4 py-4 text-left ${inferredProvider === 'local-folder' ? 'border-primary' : ''}`}
            onClick={() => onSelect('local-folder')}
            data-testid="select-provider-local"
          >
            <FolderOpen className="mr-4 h-6 w-6 shrink-0" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-sm">
                {translate(locale, 'status.vault.provider.local')}
              </span>
              <span className="text-xs text-muted-foreground whitespace-normal">
                {translate(locale, 'status.vault.provider.local.description')}
              </span>
            </div>
          </Button>

          <Button
            variant="outline"
            className={`h-auto justify-start px-4 py-4 text-left ${inferredProvider === 'icloud-drive' ? 'border-primary' : ''}`}
            onClick={() => onSelect('icloud-drive')}
            data-testid="select-provider-icloud"
          >
            <Cloud className="mr-4 h-6 w-6 shrink-0 text-blue-500" />
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-sm">
                {translate(locale, 'status.vault.provider.icloud')}
              </span>
              <span className="text-xs text-muted-foreground whitespace-normal">
                {translate(locale, 'status.vault.provider.icloud.description')}
              </span>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
