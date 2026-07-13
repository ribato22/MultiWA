"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

// Custom Select replacing @radix-ui/react-select. Same exported API used
// across the app: <Select value onValueChange><SelectTrigger><SelectValue
// placeholder /></SelectTrigger><SelectContent><SelectItem value>...
//
// The dropdown panel is rendered into a portal and positioned via the
// trigger's bounding rect so it never gets clipped by `overflow-hidden`
// ancestors (several dashboard cards use that class).

interface SelectContextValue {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  selectedLabel: React.ReactNode
  registerItem: (value: string, label: React.ReactNode) => void
  triggerRef: React.RefObject<HTMLButtonElement>
}
const SelectContext = React.createContext<SelectContextValue | null>(null)

function useSelectContext() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error("Select components must be used within <Select>")
  return ctx
}

interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
  disabled?: boolean
}

function Select({ value = "", onValueChange = () => {}, children }: SelectProps) {
  const [open, setOpen] = React.useState(false)
  const [labels, setLabels] = React.useState<Record<string, React.ReactNode>>({})
  const triggerRef = React.useRef<HTMLButtonElement>(null)

  const registerItem = React.useCallback((itemValue: string, label: React.ReactNode) => {
    setLabels((prev) => (prev[itemValue] === label ? prev : { ...prev, [itemValue]: label }))
  }, [])

  const selectedLabel = labels[value]

  return (
    <SelectContext.Provider
      value={{ value, onValueChange, open, setOpen, selectedLabel, registerItem, triggerRef }}
    >
      {children}
    </SelectContext.Provider>
  )
}

// No-op passthrough kept for API compatibility with prior Radix-based usage.
function SelectGroup({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function SelectValue({ placeholder }: { placeholder?: React.ReactNode }) {
  const { selectedLabel } = useSelectContext()
  return <span className="line-clamp-1">{selectedLabel ?? placeholder}</span>
}

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, disabled, onClick, ...props }, ref) => {
  const { open, setOpen, triggerRef } = useSelectContext()
  return (
    <button
      ref={(node) => {
        ;(triggerRef as React.MutableRefObject<HTMLButtonElement | null>).current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node
      }}
      type="button"
      role="combobox"
      aria-expanded={open}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        if (!disabled) setOpen(!open)
      }}
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-astryx transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer [&>span]:line-clamp-1",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
    </button>
  )
})
SelectTrigger.displayName = "SelectTrigger"

interface Rect {
  top: number
  left: number
  width: number
}

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { open, setOpen, triggerRef } = useSelectContext()
  const [rect, setRect] = React.useState<Rect | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => setMounted(true), [])

  const updateRect = React.useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [triggerRef])

  React.useEffect(() => {
    if (!open) return
    updateRect()
    window.addEventListener("resize", updateRect)
    window.addEventListener("scroll", updateRect, true)
    return () => {
      window.removeEventListener("resize", updateRect)
      window.removeEventListener("scroll", updateRect, true)
    }
  }, [open, updateRect])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open, setOpen, triggerRef])

  if (!open || !mounted || !rect || typeof document === "undefined") return null

  return createPortal(
    <div
      ref={(node) => {
        ;(panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }}
      role="listbox"
      style={{ position: "fixed", top: rect.top, insetInlineStart: rect.left, minWidth: rect.width }}
      className={cn(
        "z-50 max-h-72 overflow-y-auto overflow-x-hidden rounded-lg border bg-popover text-popover-foreground shadow-astryx-md p-1 animate-fade-in",
        className
      )}
      {...props}
    >
      {children}
    </div>,
    document.body
  )
})
SelectContent.displayName = "SelectContent"

const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("px-2 py-1.5 text-sm font-semibold", className)} {...props} />
  )
)
SelectLabel.displayName = "SelectLabel"

const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean }
>(({ className, children, value, disabled, onClick, ...props }, ref) => {
  const { value: selected, onValueChange, registerItem, setOpen } = useSelectContext()
  const isSelected = selected === value

  React.useEffect(() => {
    registerItem(value, children)
  }, [value, children, registerItem])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isSelected}
      data-disabled={disabled || undefined}
      onClick={(e) => {
        if (disabled) return
        onClick?.(e)
        onValueChange(value)
        setOpen(false)
      }}
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 ps-2 pe-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute end-2 flex h-3.5 w-3.5 items-center justify-center">
        {isSelected && <Check className="h-4 w-4" />}
      </span>
      {children}
    </div>
  )
})
SelectItem.displayName = "SelectItem"

const SelectSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
  )
)
SelectSeparator.displayName = "SelectSeparator"

// Kept as no-op stubs for API compatibility (unused with a scrollable panel).
function SelectScrollUpButton() {
  return null
}
function SelectScrollDownButton() {
  return null
}

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
