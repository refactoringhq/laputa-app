"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import {
  DayPicker,
  getDefaultClassNames,
  type ChevronProps,
  type DayButton,
  type DropdownProps,
  type RootProps,
  type WeekNumberProps,
} from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const CALENDAR_START_MONTH = new Date(1900, 0)
const CALENDAR_END_MONTH = new Date(2100, 11)

type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "dropdown",
  navLayout,
  buttonVariant = "ghost",
  formatters,
  components,
  startMonth = CALENDAR_START_MONTH,
  endMonth = CALENDAR_END_MONTH,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3 [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      captionLayout={captionLayout}
      navLayout={navLayout}
      startMonth={startMonth}
      endMonth={endMonth}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={getCalendarClassNames({
        defaultClassNames,
        classNames,
        captionLayout,
        buttonVariant,
        showWeekNumber: props.showWeekNumber,
      })}
      components={{
        Root: CalendarRoot,
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        WeekNumber: CalendarWeekNumber,
        Dropdown: CalendarDropdown,
        ...components,
      }}
      {...props}
    />
  )
}

function getCalendarClassNames({
  defaultClassNames,
  classNames,
  captionLayout,
  buttonVariant,
  showWeekNumber,
}: {
  defaultClassNames: ReturnType<typeof getDefaultClassNames>
  classNames: CalendarProps["classNames"]
  captionLayout: CalendarProps["captionLayout"]
  buttonVariant: CalendarProps["buttonVariant"]
  showWeekNumber: CalendarProps["showWeekNumber"]
}) {
  return {
    root: cn("w-fit", defaultClassNames.root),
    months: cn("flex gap-4 flex-col md:flex-row relative", defaultClassNames.months),
    month: cn("flex flex-col w-full gap-4", defaultClassNames.month),
    nav: cn("pointer-events-none flex items-center gap-1 w-full absolute top-0 inset-x-0 justify-between", defaultClassNames.nav),
    button_previous: cn(
      buttonVariants({ variant: buttonVariant }),
      "pointer-events-auto size-(--cell-size) aria-disabled:opacity-50 p-0 select-none hover:bg-transparent",
      defaultClassNames.button_previous
    ),
    button_next: cn(
      buttonVariants({ variant: buttonVariant }),
      "pointer-events-auto size-(--cell-size) aria-disabled:opacity-50 p-0 select-none hover:bg-transparent",
      defaultClassNames.button_next
    ),
    month_caption: cn(
      "flex items-center justify-center h-(--cell-size) w-full px-(--cell-size)",
      defaultClassNames.month_caption
    ),
    dropdowns: cn(
      "w-full flex items-center text-sm font-medium justify-center h-(--cell-size) gap-1.5",
      defaultClassNames.dropdowns
    ),
    dropdown_root: cn(
      "relative has-focus:border-ring border border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] rounded-md",
      defaultClassNames.dropdown_root
    ),
    dropdown: cn("absolute bg-popover inset-0 opacity-0", defaultClassNames.dropdown),
    caption_label: cn(
      "select-none font-medium",
      captionLayout === "label"
        ? "text-sm"
        : "rounded-md pl-2 pr-1 flex items-center gap-1 text-sm h-8 [&>svg]:text-muted-foreground [&>svg]:size-3.5",
      defaultClassNames.caption_label
    ),
    table: "w-full border-collapse",
    weekdays: cn("flex", defaultClassNames.weekdays),
    weekday: cn("text-muted-foreground rounded-md flex-1 font-normal text-[0.8rem] select-none", defaultClassNames.weekday),
    week: cn("flex w-full mt-2", defaultClassNames.week),
    week_number_header: cn("select-none w-(--cell-size)", defaultClassNames.week_number_header),
    week_number: cn("text-[0.8rem] select-none text-muted-foreground", defaultClassNames.week_number),
    day: cn(
      "relative w-full h-full p-0 text-center [&:last-child[data-selected=true]_button]:rounded-r-md group/day aspect-square select-none",
      showWeekNumber
        ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-md"
        : "[&:first-child[data-selected=true]_button]:rounded-l-md",
      defaultClassNames.day
    ),
    range_start: cn("rounded-l-md bg-accent", defaultClassNames.range_start),
    range_middle: cn("rounded-none", defaultClassNames.range_middle),
    range_end: cn("rounded-r-md bg-accent", defaultClassNames.range_end),
    today: cn("bg-accent text-accent-foreground rounded-md data-[selected=true]:rounded-none", defaultClassNames.today),
    outside: cn("text-muted-foreground aria-selected:text-muted-foreground", defaultClassNames.outside),
    disabled: cn("text-muted-foreground opacity-50", defaultClassNames.disabled),
    hidden: cn("invisible", defaultClassNames.hidden),
    ...classNames,
  }
}

function CalendarRoot({ className, rootRef, ...props }: RootProps) {
  return (
    <div
      data-slot="calendar"
      ref={rootRef}
      className={cn(className)}
      {...props}
    />
  )
}

function CalendarChevron({ className, orientation, ...props }: ChevronProps) {
  if (orientation === "left") {
    return <ChevronLeftIcon className={cn("size-4", className)} {...props} />
  }

  if (orientation === "right") {
    return <ChevronRightIcon className={cn("size-4", className)} {...props} />
  }

  return <ChevronDownIcon className={cn("size-4", className)} {...props} />
}

function CalendarWeekNumber({ children, ...props }: WeekNumberProps) {
  return (
    <td {...props}>
      <div className="flex size-(--cell-size) items-center justify-center text-center">
        {children}
      </div>
    </td>
  )
}

function CalendarDropdown({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
}: DropdownProps) {
  const handleValueChange = (newValue: string) => {
    onChange?.({
      target: { value: newValue },
    } as React.ChangeEvent<HTMLSelectElement>)
  }

  return (
    <Select value={value?.toString()} onValueChange={handleValueChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        size="sm"
        className="h-8 min-w-[88px] justify-center gap-1 bg-background px-2 py-0 text-sm font-medium"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="z-[13000] max-h-64">
        <SelectGroup>
          {options?.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value.toString()}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground data-[range-middle=true]:bg-accent data-[range-middle=true]:text-accent-foreground data-[range-start=true]:bg-primary data-[range-start=true]:text-primary-foreground data-[range-end=true]:bg-primary data-[range-end=true]:text-primary-foreground group-data-[focused=true]/day:border-ring group-data-[focused=true]/day:ring-ring/50 dark:hover:text-accent-foreground flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 leading-none font-normal group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:ring-[3px] data-[range-end=true]:rounded-md data-[range-end=true]:rounded-r-md data-[range-middle=true]:rounded-none data-[range-start=true]:rounded-md data-[range-start=true]:rounded-l-md [&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
