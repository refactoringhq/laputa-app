import type { MouseEvent } from 'react'
import { Check } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import { ACCENT_COLOR_PICKER_COLORS } from '../utils/typeColors'

type AccentColorIndicator = 'border' | 'check'

interface AccentColorPickerProps {
  className?: string
  disabled?: boolean
  getOptionTestId?: (key: string) => string
  indicator?: AccentColorIndicator
  onSelectColor: (key: string) => void
  selectedColor: string | null
  size?: number
  stopPropagation?: boolean
}

const DEFAULT_SWATCH_SIZE = 24

function selectedBorder(indicator: AccentColorIndicator, selected: boolean): string {
  if (indicator === 'check') return '0 solid transparent'
  return selected ? '2px solid var(--foreground)' : '2px solid transparent'
}

export function AccentColorPicker(options: AccentColorPickerProps) {
  const {
    className,
    disabled = false,
    getOptionTestId,
    indicator = 'border',
    onSelectColor,
    selectedColor,
    size = DEFAULT_SWATCH_SIZE,
    stopPropagation = false,
  } = options
  const handleSelect = (event: MouseEvent<HTMLButtonElement>, key: string) => {
    if (stopPropagation) event.stopPropagation()
    if (!disabled) onSelectColor(key)
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {ACCENT_COLOR_PICKER_COLORS.map((color) => {
        const selected = selectedColor === color.key
        return (
          <Button
            key={color.key}
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              'shrink-0 rounded-full p-0 transition-transform',
              disabled ? 'cursor-not-allowed opacity-50' : selected ? 'scale-110' : 'hover:scale-105',
            )}
            style={{
              width: size,
              height: size,
              backgroundColor: color.css,
              border: selectedBorder(indicator, selected),
            }}
            title={color.label}
            aria-label={color.label}
            data-testid={getOptionTestId?.(color.key)}
            disabled={disabled}
            onClick={(event) => handleSelect(event, color.key)}
          >
            {indicator === 'check' && selected && (
              <Check
                size={Math.max(8, Math.round(size * 0.58))}
                weight="bold"
                style={{ color: 'var(--text-inverse)' }}
              />
            )}
          </Button>
        )
      })}
    </div>
  )
}
