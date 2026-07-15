"use client"

import * as React from "react"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

// Native <input type="checkbox"> visually hidden, with a styled sibling box
// that reflects checked state via peer-checked. Replaces @radix-ui/react-checkbox.
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, id, ...props }, ref) => {
    return (
      <span className={cn("relative inline-flex h-4 w-4 shrink-0", className)}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className="peer absolute inset-0 h-4 w-4 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "grid h-4 w-4 place-content-center rounded-sm border border-primary shadow-astryx transition-colors",
            "peer-checked:bg-primary peer-checked:text-primary-foreground",
            "peer-focus-visible:outline-none peer-focus-visible:ring-1 peer-focus-visible:ring-ring",
            "peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
          )}
        >
          {checked && <Check className="h-3.5 w-3.5" />}
        </span>
      </span>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
