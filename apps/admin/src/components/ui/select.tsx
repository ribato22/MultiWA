"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface SelectContextValue {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  selectedLabel: React.ReactNode
  registerItem: (value: string, label: React.ReactNode) => void
  triggerRef: React.RefObject<HTMLButtonElement>
  contentId: string
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
  const contentId = React.useId()
  const registerItem = React.useCallback((itemValue: string, label: React.ReactNode) => {
    setLabels((prev) => (prev[itemValue] === label ? prev : { ...prev, [itemValue]: label }))
  }, [])

  return <SelectContext.Provider value={{ value, onValueChange, open, setOpen, selectedLabel: labels[value], registerItem, triggerRef, contentId }}>{children}</SelectContext.Provider>
}

function SelectGroup({ children }: { children?: React.ReactNode }) { return <>{children}</> }
function SelectValue({ placeholder }: { placeholder?: React.ReactNode }) {
  const { selectedLabel } = useSelectContext()
  return <span className="line-clamp-1">{selectedLabel ?? placeholder}</span>
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(({ className, children, disabled, onClick, onKeyDown, ...props }, ref) => {
  const { open, setOpen, triggerRef, contentId } = useSelectContext()
  const setRefs = (node: HTMLButtonElement | null) => {
    ;(triggerRef as React.MutableRefObject<HTMLButtonElement | null>).current = node
    if (typeof ref === "function") ref(node)
    else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node
  }
  return <button ref={setRefs} type="button" role="combobox" aria-haspopup="listbox" aria-controls={contentId} aria-expanded={open} disabled={disabled} onClick={(event) => { onClick?.(event); if (!disabled) setOpen(!open) }} onKeyDown={(event) => { onKeyDown?.(event); if (!event.defaultPrevented && !disabled && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); setOpen(true) } }} className={cn("flex h-9 w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-astryx transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer [&>span]:line-clamp-1", className)} {...props}>{children}<ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" /></button>
})
SelectTrigger.displayName = "SelectTrigger"

interface Rect { top: number; inlineStart: number; width: number; direction: "ltr" | "rtl" }
const SelectContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, children, ...props }, ref) => {
  const { open, setOpen, triggerRef, value, contentId } = useSelectContext()
  const [rect, setRect] = React.useState<Rect | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => setMounted(true), [])
  const close = React.useCallback(() => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()) }, [setOpen, triggerRef])
  const updateRect = React.useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const bounds = trigger.getBoundingClientRect()
    const direction = (trigger.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir ?? getComputedStyle(trigger).direction) === "rtl" ? "rtl" : "ltr"
    setRect({ top: bounds.bottom + 4, inlineStart: direction === "rtl" ? window.innerWidth - bounds.right : bounds.left, width: bounds.width, direction })
  }, [triggerRef])
  React.useEffect(() => { if (!open) return; updateRect(); window.addEventListener("resize", updateRect); window.addEventListener("scroll", updateRect, true); return () => { window.removeEventListener("resize", updateRect); window.removeEventListener("scroll", updateRect, true) } }, [open, updateRect])
  React.useEffect(() => {
    if (!open) return
    const enabledOptions = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])') ?? [])
    const focusInitial = () => { const options = enabledOptions(); (options.find((option) => option.getAttribute("aria-selected") === "true") ?? options[0])?.focus() }
    requestAnimationFrame(focusInitial)
    const onPointerDown = (event: MouseEvent) => { const target = event.target as Node; if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false) }
    const onKeyDown = (event: KeyboardEvent) => {
      const options = enabledOptions(); const current = document.activeElement as HTMLElement; const index = options.indexOf(current)
      if (event.key === "Escape") { event.preventDefault(); close() }
      else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && options.length) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length; options[next].focus() }
      else if (["Enter", " "].includes(event.key) && index >= 0) { event.preventDefault(); current.click() }
    }
    document.addEventListener("mousedown", onPointerDown); document.addEventListener("keydown", onKeyDown)
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown) }
  }, [close, open, triggerRef, value])
  if (!open || !mounted || !rect || typeof document === "undefined") return null
  return createPortal(<div ref={(node) => { ;(panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node; if (typeof ref === "function") ref(node); else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node }} id={contentId} dir={rect.direction} role="listbox" style={{ position: "fixed", top: rect.top, insetInlineStart: rect.inlineStart, minWidth: rect.width }} className={cn("z-50 max-h-72 overflow-y-auto overflow-x-hidden rounded-lg border bg-popover text-popover-foreground shadow-astryx-md p-1 animate-fade-in", className)} {...props}>{children}</div>, document.body)
})
SelectContent.displayName = "SelectContent"

const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("px-2 py-1.5 text-sm font-semibold", className)} {...props} />)
SelectLabel.displayName = "SelectLabel"
const SelectItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean }>(({ className, children, value, disabled, onClick, ...props }, ref) => {
  const { value: selected, onValueChange, registerItem, setOpen, triggerRef } = useSelectContext()
  const isSelected = selected === value
  React.useEffect(() => { registerItem(value, children) }, [value, children, registerItem])
  return <div ref={ref} role="option" tabIndex={disabled ? -1 : isSelected ? 0 : -1} aria-selected={isSelected} aria-disabled={disabled || undefined} data-disabled={disabled || undefined} onClick={(event) => { if (disabled) return; onClick?.(event); onValueChange(value); setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()) }} className={cn("relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 ps-2 pe-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props}><span className="absolute end-2 flex h-3.5 w-3.5 items-center justify-center">{isSelected && <Check className="h-4 w-4" />}</span>{children}</div>
})
SelectItem.displayName = "SelectItem"
const SelectSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />)
SelectSeparator.displayName = "SelectSeparator"
function SelectScrollUpButton() { return null }
function SelectScrollDownButton() { return null }
export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectLabel, SelectItem, SelectSeparator, SelectScrollUpButton, SelectScrollDownButton }
