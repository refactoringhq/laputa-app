import * as React from 'react'
import { Check } from '@phosphor-icons/react'

import { cn } from '@/lib/utils'

export type CheckedState = boolean | 'indeterminate'

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'checked' | 'onChange' | 'type'> {
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
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = checked === 'indeterminate'
  }, [checked])

  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
      <input
        ref={inputRef}
        type="checkbox"
        checked={isChecked}
        aria-checked={checked === 'indeterminate' ? 'mixed' : isChecked}
        data-slot="checkbox"
        data-state={isChecked ? 'checked' : 'unchecked'}
        disabled={disabled}
        className={cn(
          'peer border-input dark:bg-input/30 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 appearance-none rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onChange={() => {
          if (disabled) return
          onCheckedChange?.(!isChecked)
        }}
        {...props}
      />
      {isChecked && (
        <span
          data-slot="checkbox-indicator"
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-primary-foreground transition-none"
        >
          <Check className="size-3.5" />
        </span>
      )}
    </span>
  )
}

export { Checkbox }
