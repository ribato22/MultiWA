"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface TabsContextValue { value: string; setValue: (value: string) => void; baseId: string }
const TabsContext = React.createContext<TabsContextValue | null>(null)
function useTabsContext() { const ctx = React.useContext(TabsContext); if (!ctx) throw new Error("Tabs components must be used within <Tabs>"); return ctx }
interface TabsProps extends React.HTMLAttributes<HTMLDivElement> { defaultValue?: string; value?: string; onValueChange?: (value: string) => void }
const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(({ defaultValue, value, onValueChange, className, children, ...props }, ref) => { const [internalValue, setInternalValue] = React.useState(defaultValue ?? ""); const isControlled = value !== undefined; const current = isControlled ? value : internalValue; const baseId = React.useId(); const setValue = React.useCallback((next: string) => { if (!isControlled) setInternalValue(next); onValueChange?.(next) }, [isControlled, onValueChange]); return <TabsContext.Provider value={{ value: current, setValue, baseId }}><div ref={ref} className={className} {...props}>{children}</div></TabsContext.Provider> })
Tabs.displayName = "Tabs"
const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => <div ref={ref} role="tablist" className={cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />)
TabsList.displayName = "TabsList"
const TabsTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }>(({ className, value, onClick, onKeyDown, disabled, ...props }, ref) => {
  const { value: active, setValue, baseId } = useTabsContext(); const isActive = active === value; const tabId = `${baseId}-tab-${value}`; const panelId = `${baseId}-panel-${value}`
  return <button ref={ref} type="button" role="tab" id={tabId} aria-controls={panelId} aria-selected={isActive} aria-disabled={disabled || undefined} tabIndex={isActive ? 0 : -1} disabled={disabled} data-state={isActive ? "active" : "inactive"} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented && !disabled) setValue(value) }} onKeyDown={(event) => { onKeyDown?.(event); if (event.defaultPrevented) return; const list = event.currentTarget.closest('[role="tablist"]'); const tabs = Array.from(list?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? []); const index = tabs.indexOf(event.currentTarget); if (!tabs.length || !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return; event.preventDefault(); const rtl = getComputedStyle(event.currentTarget).direction === "rtl"; const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + ((event.key === "ArrowRight") === !rtl ? 1 : -1) + tabs.length) % tabs.length; tabs[next].focus(); tabs[next].click() }} className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer", isActive ? "bg-background text-foreground shadow" : "hover:text-foreground/80", className)} {...props} />
})
TabsTrigger.displayName = "TabsTrigger"
const TabsContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { value: string }>(({ className, value, ...props }, ref) => { const { value: active, baseId } = useTabsContext(); if (active !== value) return null; return <div ref={ref} role="tabpanel" id={`${baseId}-panel-${value}`} aria-labelledby={`${baseId}-tab-${value}`} tabIndex={0} className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)} {...props} /> })
TabsContent.displayName = "TabsContent"
export { Tabs, TabsList, TabsTrigger, TabsContent }
