"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

// Native <input type="checkbox"> (role via browser semantics) styled as a
// pill toggle. Replaces @radix-ui/react-switch. The thumb slides along the
// inline-end direction via a logical-aware transform class so it flips
// automatically under [dir=rtl].
const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, id, ...props }, ref) => {
    return (
      <span className={cn("relative inline-flex h-5 w-9 shrink-0", className)}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={!!checked}
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className="peer absolute inset-0 h-5 w-9 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex h-5 w-9 items-center rounded-full border-2 border-transparent shadow-astryx transition-colors",
            "bg-input peer-checked:bg-primary",
            "peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          )}
        >
          <span
            className={cn(
              "block h-4 w-4 rounded-full bg-background shadow-lg transition-transform",
              "translate-x-0 rtl:-translate-x-0",
              checked ? "translate-x-4 rtl:-translate-x-4" : "translate-x-0"
            )}
          />
        </span>
      </span>
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
