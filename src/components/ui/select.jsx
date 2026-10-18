"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { Drawer } from "vaul"

import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"

// On phones and tablets the choices open as a bottom sheet (vaul drawer) rather than a small
// popover list, which is easier to reach and read on a small screen. Desktop is unchanged.
const SelectSheetContext = React.createContext(null)

const Select = ({ value, onValueChange, children, ...props }) => {
  const isMobile = useIsMobile()
  const [open, setOpen] = React.useState(false)
  const [picked, setPicked] = React.useState(value)

  React.useEffect(() => {
    if (value !== undefined) setPicked(value)
  }, [value])

  const select = (next) => {
    setPicked(next)
    onValueChange?.(next)
  }

  return (
    <SelectSheetContext.Provider value={{ isMobile, open, setOpen, value: picked ?? "", select }}>
      <SelectPrimitive.Root value={value} onValueChange={select} {...props}>
        {children}
      </SelectPrimitive.Root>
    </SelectSheetContext.Provider>
  )
}

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => {
  const sheet = React.useContext(SelectSheetContext)

  const triggerClassName = cn(
    "flex h-11 sm:h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
    className
  )

  // On mobile the trigger opens the sheet instead of the popover list.
  if (sheet?.isMobile) {
    return (
      <button
        type="button"
        ref={ref}
        className={triggerClassName}
        data-placeholder={sheet.value ? undefined : ""}
        aria-haspopup="listbox"
        aria-expanded={sheet.open}
        onClick={() => sheet.setOpen(true)}
        {...props}>
        {children}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
    )
  }

  return (
    <SelectPrimitive.Trigger ref={ref} className={triggerClassName} {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
})
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

// The sheet's rows come from the SelectItem elements the caller already renders: their value,
// their label and whether they are disabled.
const collectOptions = (children, options = []) => {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem || child.type === SelectPrimitive.Item) {
      options.push({
        value: child.props.value,
        label: child.props.children,
        disabled: child.props.disabled,
      })
    } else if (child.type === SelectGroup || child.type === SelectPrimitive.Group) {
      collectOptions(child.props.children, options)
    }
  })
  return options
}

const SelectSheet = ({ open, onOpenChange, value, onSelect, children }) => {
  const options = React.useMemo(() => collectOptions(children), [children])

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-black/70 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-h-[80vh] w-full max-w-lg flex-col rounded-t-2xl border-t border-primary/25 bg-popover pt-3 text-popover-foreground shadow-lg outline-none"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 16px) + 16px)" }}>
          <Drawer.Title className="sr-only">Choose an option</Drawer.Title>
          <div className="mx-auto h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/40" />
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
            {options.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No options to choose from.
              </p>
            )}
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => {
                  onSelect(option.value)
                  onOpenChange(false)
                }}
                className={cn(
                  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-base leading-snug transition-colors active:bg-accent disabled:pointer-events-none disabled:opacity-50",
                  option.value === value ? "text-primary" : "text-popover-foreground"
                )}>
                <span className="line-clamp-2">{option.label}</span>
                {option.value === value && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

const SelectContent = React.forwardRef(({ className, children, position = "popper", ...props }, ref) => {
  const sheet = React.useContext(SelectSheetContext)

  if (sheet?.isMobile) {
    return (
      <>
        {/* Radix keeps a closed content mounted out of view, which is what lets the chosen
            option's own text fill the trigger on mobile. */}
        <SelectPrimitive.Content ref={ref} className="hidden" position={position} {...props}>
          {children}
        </SelectPrimitive.Content>
        <SelectSheet
          open={sheet.open}
          onOpenChange={sheet.setOpen}
          value={sheet.value}
          onSelect={sheet.select}>
          {children}
        </SelectSheet>
      </>
    )
  }

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}>
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}