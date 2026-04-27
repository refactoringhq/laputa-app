import * as React from 'react'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

export type CheckedState = boolean | 'indeterminate'

interface CheckboxProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: CheckedState
  onCheckedChange?: (checked: CheckedState) => void
}

function Checkbox({
  className,
  checked = false,
  disabled = false,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  const isChecked = checked === true

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isChecked}
      data-slot="checkbox"
      data-state={isChecked ? 'checked' : 'unchecked'}
      disabled={disabled}
      className={cn(
        'peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 cursor-pointer rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onClick={() => {
        if (disabled) return
        onCheckedChange?.(!isChecked)
      }}
      {...props}
    >
      {isChecked && (
        <span
          data-slot="checkbox-indicator"
          className="flex items-center justify-center text-current transition-none"
        >
          <Check className="size-3.5" />
        </span>
      )}
    </button>
  )
}

export { Checkbox }
