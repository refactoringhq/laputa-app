import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "bg-popover text-popover-foreground z-[12000] w-72 origin-(--radix-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

interface PopoverTextSlotProps extends React.HTMLAttributes<HTMLElement> {
  baseClassName: string
  element: "div" | "p"
  slot: string
}

function PopoverTextSlot({
  baseClassName,
  className,
  element,
  slot,
  ...props
}: PopoverTextSlotProps) {
  return React.createElement(
    element,
    {
      "data-slot": slot,
      className: cn(baseClassName, className),
      ...props,
    },
  )
}

function PopoverHeader(props: React.ComponentProps<"div">) {
  return (
    <PopoverTextSlot
      baseClassName="flex flex-col gap-1 text-sm"
      element="div"
      slot="popover-header"
      {...props}
    />
  )
}

function PopoverTitle(props: React.ComponentProps<"div">) {
  return <PopoverTextSlot baseClassName="font-medium" element="div" slot="popover-title" {...props} />
}

function PopoverDescription(props: React.ComponentProps<"p">) {
  return <PopoverTextSlot baseClassName="text-muted-foreground" element="p" slot="popover-description" {...props} />
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
