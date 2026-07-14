"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Slot } from "@/lib/slot"

interface DropdownMenuContextValue { open: boolean; setOpen: (open: boolean) => void; triggerRef: React.RefObject<HTMLElement>; contentId: string }
const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null)
function useDropdownMenuContext() { const ctx = React.useContext(DropdownMenuContext); if (!ctx) throw new Error("DropdownMenu components must be used within <DropdownMenu>"); return ctx }
function DropdownMenu({ children }: { children?: React.ReactNode }) { const [open, setOpen] = React.useState(false); const triggerRef = React.useRef<HTMLElement>(null); const contentId = React.useId(); return <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, contentId }}>{children}</DropdownMenuContext.Provider> }

const DropdownMenuTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(({ asChild, onClick, onKeyDown, children, ...props }, ref) => {
  const { open, setOpen, triggerRef, contentId } = useDropdownMenuContext()
  const setRefs = (node: HTMLButtonElement | null) => { ;(triggerRef as React.MutableRefObject<HTMLElement | null>).current = node; if (typeof ref === "function") ref(node); else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node }
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => { onClick?.(event); if (!event.defaultPrevented) setOpen(!open) }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => { onKeyDown?.(event); if (!event.defaultPrevented && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) { event.preventDefault(); setOpen(true) } }
  const attributes = { "aria-haspopup": "menu" as const, "aria-controls": contentId, "aria-expanded": open, onClick: handleClick, onKeyDown: handleKeyDown }
  return asChild ? <Slot ref={setRefs} {...attributes} {...props}>{children}</Slot> : <button ref={setRefs} type="button" {...attributes} {...props}>{children}</button>
})
DropdownMenuTrigger.displayName = "DropdownMenuTrigger"

interface Rect { top: number; inlineStart: number; inlineEnd: number; direction: "ltr" | "rtl" }
const DropdownMenuContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" | "center"; sideOffset?: number }>(({ className, align = "start", sideOffset = 4, children, ...props }, ref) => {
  const { open, setOpen, triggerRef, contentId } = useDropdownMenuContext(); const [rect, setRect] = React.useState<Rect | null>(null); const [mounted, setMounted] = React.useState(false); const panelRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => setMounted(true), [])
  const dismiss = React.useCallback(() => setOpen(false), [setOpen]); const dismissAndRestore = React.useCallback(() => { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()) }, [setOpen, triggerRef])
  const updateRect = React.useCallback(() => { const trigger = triggerRef.current; if (!trigger) return; const bounds = trigger.getBoundingClientRect(); const direction = (trigger.closest("[dir]")?.getAttribute("dir") ?? document.documentElement.dir ?? getComputedStyle(trigger).direction) === "rtl" ? "rtl" : "ltr"; setRect({ top: bounds.bottom + sideOffset, inlineStart: direction === "rtl" ? window.innerWidth - bounds.right : bounds.left, inlineEnd: direction === "rtl" ? bounds.left : window.innerWidth - bounds.right, direction }) }, [sideOffset, triggerRef])
  React.useEffect(() => { if (!open) return; updateRect(); window.addEventListener("resize", updateRect); window.addEventListener("scroll", updateRect, true); return () => { window.removeEventListener("resize", updateRect); window.removeEventListener("scroll", updateRect, true) } }, [open, updateRect])
  React.useEffect(() => { if (!open) return; const enabledItems = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []); requestAnimationFrame(() => enabledItems()[0]?.focus()); const onPointerDown = (event: MouseEvent) => { const target = event.target as Node; if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) dismiss() }; const onKeyDown = (event: KeyboardEvent) => { const items = enabledItems(); const index = items.indexOf(document.activeElement as HTMLElement); if (event.key === "Escape") { event.preventDefault(); dismissAndRestore() } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && items.length) { event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus() } else if (["Enter", " "].includes(event.key) && index >= 0) { event.preventDefault(); items[index].click() } }; document.addEventListener("mousedown", onPointerDown); document.addEventListener("keydown", onKeyDown); return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown) } }, [dismiss, dismissAndRestore, open, triggerRef])
  if (!open || !mounted || !rect || typeof document === "undefined") return null
  const position = align === "end" ? { insetInlineEnd: rect.inlineEnd } : { insetInlineStart: rect.inlineStart }
  return createPortal(<div ref={(node) => { ;(panelRef as React.MutableRefObject<HTMLDivElement | null>).current = node; if (typeof ref === "function") ref(node); else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node }} id={contentId} dir={rect.direction} role="menu" style={{ position: "fixed", top: rect.top, ...position }} className={cn("z-50 min-w-[8rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-astryx-md animate-fade-in", className)} {...props}>{children}</div>, document.body)
})
DropdownMenuContent.displayName = "DropdownMenuContent"

const DropdownMenuItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { inset?: boolean; disabled?: boolean }>(({ className, inset, disabled, onClick, ...props }, ref) => { const { setOpen, triggerRef } = useDropdownMenuContext(); return <div ref={ref} role="menuitem" tabIndex={disabled ? -1 : -1} aria-disabled={disabled || undefined} data-disabled={disabled || undefined} onClick={(event) => { if (disabled) return; onClick?.(event); if (!event.defaultPrevented) { setOpen(false); requestAnimationFrame(() => triggerRef.current?.focus()) } }} className={cn("relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0", inset && "ps-8", className)} {...props} /> })
DropdownMenuItem.displayName = "DropdownMenuItem"
const DropdownMenuCheckboxItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }>(({ className, children, checked, onCheckedChange, ...props }, ref) => <div ref={ref} role="menuitemcheckbox" tabIndex={-1} aria-checked={!!checked} onClick={() => onCheckedChange?.(!checked)} className={cn("relative flex cursor-pointer select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground", className)} {...props}><span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">{checked && <Check className="h-4 w-4" />}</span>{children}</div>)
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem"
const DropdownMenuRadioItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { checked?: boolean }>(({ className, children, checked, ...props }, ref) => <div ref={ref} role="menuitemradio" tabIndex={-1} aria-checked={!!checked} className={cn("relative flex cursor-pointer select-none items-center rounded-sm py-1.5 ps-8 pe-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground", className)} {...props}><span className="absolute start-2 flex h-3.5 w-3.5 items-center justify-center">{checked && <Circle className="h-2 w-2 fill-current" />}</span>{children}</div>)
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem"
const DropdownMenuLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }>(({ className, inset, ...props }, ref) => <div ref={ref} className={cn("px-2 py-1.5 text-sm font-semibold", inset && "ps-8", className)} {...props} />)
DropdownMenuLabel.displayName = "DropdownMenuLabel"
const DropdownMenuSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />)
DropdownMenuSeparator.displayName = "DropdownMenuSeparator"
const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span className={cn("ms-auto text-xs tracking-widest opacity-60", className)} {...props} />
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"
const DropdownMenuGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>; const DropdownMenuPortal = ({ children }: { children?: React.ReactNode }) => <>{children}</>; const DropdownMenuSub = ({ children }: { children?: React.ReactNode }) => <>{children}</>; const DropdownMenuRadioGroup = ({ children }: { children?: React.ReactNode }) => <>{children}</>
const DropdownMenuSubTrigger = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }>(({ className, inset, children, ...props }, ref) => <div ref={ref} className={cn("flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", inset && "ps-8", className)} {...props}>{children}<ChevronRight className="ms-auto" /></div>)
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger"
const DropdownMenuSubContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} className={cn("z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-astryx-md", className)} {...props} />)
DropdownMenuSubContent.displayName = "DropdownMenuSubContent"
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuGroup, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup }
