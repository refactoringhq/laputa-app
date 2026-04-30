import * as React from "react"
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group"

import { cn } from "@/lib/utils"

const itemClasses =
  "inline-flex items-center justify-center gap-1.5 px-2.5 h-7 text-xs font-medium text-muted-foreground rounded-sm transition-colors hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-ring/50 focus-visible:ring-2"

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5",
        className,
      )}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(itemClasses, className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
