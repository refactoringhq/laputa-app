"use client"

import * as React from "react"
import { CaretRight as ChevronRightIcon, Check as CheckIcon, Circle as CircleIcon } from '@phosphor-icons/react'
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const dropdownMenuContentMotionClass =
  "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 origin-(--radix-dropdown-menu-content-transform-origin) rounded-md border p-1"

const dropdownMenuCheckedItemClass =
  "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

const dropdownMenuItemIndicatorClass =
  "pointer-events-none absolute left-2 flex size-3.5 items-center justify-center"

function createDropdownMenuSlot<T extends React.ElementType>(
  Component: T,
  slot: string,
  displayName: string
) {
  function DropdownMenuSlot(props: React.ComponentProps<T>) {
    return React.createElement(Component, { "data-slot": slot, ...props })
  }

  DropdownMenuSlot.displayName = displayName
  return DropdownMenuSlot
}

function DropdownMenuItemIndicator({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <span className={dropdownMenuItemIndicatorClass}>
      <DropdownMenuPrimitive.ItemIndicator>
        {children}
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  )
}

function createDropdownMenuCheckedItem<T extends React.ElementType>(
  Component: T,
  slot: string,
  indicator: React.ReactNode,
  displayName: string
) {
  type Props = React.ComponentProps<T> & {
    className?: string
    children?: React.ReactNode
  }

  function CheckedItem({ className, children, ...props }: Props) {
    return React.createElement(
      Component,
      {
        "data-slot": slot,
        ...props,
        className: cn(dropdownMenuCheckedItemClass, className),
      },
      <>
        <DropdownMenuItemIndicator>{indicator}</DropdownMenuItemIndicator>
        {children}
      </>
    )
  }

  CheckedItem.displayName = displayName
  return CheckedItem
}

const DropdownMenu = createDropdownMenuSlot(
  DropdownMenuPrimitive.Root,
  "dropdown-menu",
  "DropdownMenu"
)

const DropdownMenuPortal = createDropdownMenuSlot(
  DropdownMenuPrimitive.Portal,
  "dropdown-menu-portal",
  "DropdownMenuPortal"
)

const DropdownMenuTrigger = createDropdownMenuSlot(
  DropdownMenuPrimitive.Trigger,
  "dropdown-menu-trigger",
  "DropdownMenuTrigger"
)

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          dropdownMenuContentMotionClass,
          "max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto shadow-md",
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

const DropdownMenuGroup = createDropdownMenuSlot(
  DropdownMenuPrimitive.Group,
  "dropdown-menu-group",
  "DropdownMenuGroup"
)

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

const DropdownMenuCheckboxItem = createDropdownMenuCheckedItem(
  DropdownMenuPrimitive.CheckboxItem,
  "dropdown-menu-checkbox-item",
  <CheckIcon className="size-4" />,
  "DropdownMenuCheckboxItem"
)

const DropdownMenuRadioGroup = createDropdownMenuSlot(
  DropdownMenuPrimitive.RadioGroup,
  "dropdown-menu-radio-group",
  "DropdownMenuRadioGroup"
)

const DropdownMenuRadioItem = createDropdownMenuCheckedItem(
  DropdownMenuPrimitive.RadioItem,
  "dropdown-menu-radio-item",
  <CircleIcon className="size-2 fill-current" />,
  "DropdownMenuRadioItem"
)

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

const DropdownMenuSub = createDropdownMenuSlot(
  DropdownMenuPrimitive.Sub,
  "dropdown-menu-sub",
  "DropdownMenuSub"
)

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        dropdownMenuContentMotionClass,
        "min-w-[8rem] overflow-hidden shadow-lg",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
