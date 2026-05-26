import { useId } from 'react'
import type { GitRepositoryOption } from '../utils/gitRepositories'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface GitRepositorySelectProps {
  label: string
  onChange: (path: string) => void
  repositories: GitRepositoryOption[]
  selectedPath: string
  testId?: string
}

export function GitRepositorySelect({
  label,
  onChange,
  repositories,
  selectedPath,
  testId,
}: GitRepositorySelectProps) {
  const triggerId = useId()

  if (repositories.length <= 1) return null

  return (
    <label htmlFor={triggerId} className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <Select value={selectedPath} onValueChange={onChange}>
        <SelectTrigger
          id={triggerId}
          size="sm"
          className="h-7 min-w-0 max-w-44 flex-1 border-border bg-[var(--bg-input)] px-2 text-xs"
          data-testid={testId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="z-[13000]">
          {repositories.map((repository) => (
            <SelectItem key={repository.path} value={repository.path} className="text-xs">
              {repository.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}
