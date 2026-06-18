import * as React from "react"
import { CaretDown as ChevronDownIcon, CaretUp as ChevronUpIcon, Check as CheckIcon } from '@phosphor-icons/react'
import { Select as SelectPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function selectSlotProps(slot: string, baseClassName: string, className?: string) {
  return {
    "data-slot": slot,
    className: cn(baseClassName, className),
  }
}

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-[12000] max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-hidden rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        align={align}
        collisionPadding={collisionPadding}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

type SelectStaticPartProps =
  | (React.ComponentProps<typeof SelectPrimitive.Label> & { staticPart: "label" })
  | (React.ComponentProps<typeof SelectPrimitive.Separator> & { staticPart: "separator" })

function SelectStaticPart(props: SelectStaticPartProps) {
  if (props.staticPart === "label") {
    const { staticPart, className, ...labelProps } = props
    void staticPart
    return (
      <SelectPrimitive.Label
        {...selectSlotProps("select-label", "text-muted-foreground px-2 py-1.5 text-xs", className)}
        {...labelProps}
      />
    )
  }

  const { staticPart, className, ...separatorProps } = props
  void staticPart
  return (
    <SelectPrimitive.Separator
      {...selectSlotProps("select-separator", "bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...separatorProps}
    />
  )
}

function SelectLabel(props: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectStaticPart staticPart="label" {...props} />
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator(props: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectStaticPart staticPart="separator" {...props} />
}

function SelectScrollButton({
  className,
  direction,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton> & {
  direction: "down" | "up"
}) {
  const Primitive = direction === "up"
    ? SelectPrimitive.ScrollUpButton
    : SelectPrimitive.ScrollDownButton
  const Icon = direction === "up" ? ChevronUpIcon : ChevronDownIcon
  const slot = direction === "up" ? "select-scroll-up-button" : "select-scroll-down-button"

  return (
    <Primitive
      {...selectSlotProps(slot, "flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <Icon className="size-4" />
    </Primitive>
  )
}

function SelectScrollUpButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return <SelectScrollButton direction="up" {...props} />
}

function SelectScrollDownButton({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return <SelectScrollButton direction="down" {...props} />
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
