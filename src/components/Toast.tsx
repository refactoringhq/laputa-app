import { useEffect } from 'react'
import { cn } from '@/lib/utils'

interface ToastProps {
  message: string | null
  onDismiss: () => void
}

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, 2000)
    return () => { clearTimeout(timer); }
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className={cn(
      "fixed bottom-8 left-1/2 -translate-x-1/2 z-[1100]",
      "bg-secondary text-foreground px-5 py-2 rounded-lg text-[13px]",
      "shadow-[0_4px_16px_var(--shadow-dialog)]",
      "animate-in slide-in-from-bottom-2 fade-in duration-200"
    )}>
      {message}
    </div>
  )
}
