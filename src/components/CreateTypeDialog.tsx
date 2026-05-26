import { useId, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface CreateTypeDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (name: string) => boolean | void | Promise<boolean | void>
  initialName?: string
}

interface CreateTypeDialogFormProps {
  initialName: string
  onClose: () => void
  onCreate: (name: string) => boolean | void | Promise<boolean | void>
}

function CreateTypeDialogForm({ initialName, onClose, onCreate }: CreateTypeDialogFormProps) {
  const [name, setName] = useState(initialName)
  const nameInputId = useId()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const created = await onCreate(trimmed)
    if (created !== false) onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={nameInputId} className="text-xs font-medium text-muted-foreground">
          Type Name
        </label>
        <Input
          id={nameInputId}
          autoFocus
          placeholder="e.g. Recipe, Book, Habit..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <p className="text-xs text-muted-foreground">
          Creates a type document. Its properties become defaults for new docs of this type.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          Create
        </Button>
      </DialogFooter>
    </form>
  )
}

export function CreateTypeDialog({ open, onClose, onCreate, initialName = '' }: CreateTypeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle>Create New Type</DialogTitle>
          <DialogDescription>
            Create a type document so notes of this type can inherit templates and metadata.
          </DialogDescription>
        </DialogHeader>
        <CreateTypeDialogForm
          key={initialName}
          initialName={initialName}
          onClose={onClose}
          onCreate={onCreate}
        />
      </DialogContent>
    </Dialog>
  )
}
