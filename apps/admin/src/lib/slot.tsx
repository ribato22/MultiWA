// MultiWA Admin — minimal `asChild` slot utility.
// Replaces @radix-ui/react-slot so Button/DialogTrigger/DropdownMenuTrigger
// etc. can forward props onto a single child element without pulling in
// Radix. Not a full reimplementation (no multi-child merging edge cases),
// just enough to support the `asChild` pattern used across this codebase.
'use client';

import * as React from 'react';

function mergeRefs<T>(refs: Array<React.Ref<T> | undefined>) {
  return (value: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') ref(value);
      else (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

type AnyProps = Record<string, any>;

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...slotProps, ...childProps };
  for (const key of Object.keys(slotProps)) {
    const slotValue = slotProps[key];
    const childValue = childProps[key];
    const isHandler = /^on[A-Z]/.test(key);
    if (isHandler && typeof slotValue === 'function' && typeof childValue === 'function') {
      merged[key] = (...args: unknown[]) => {
        childValue(...args);
        slotValue(...args);
      };
    } else if (key === 'className') {
      merged[key] = [slotValue, childValue].filter(Boolean).join(' ');
    } else if (key === 'style') {
      merged[key] = { ...slotValue, ...childValue };
    }
  }
  return merged;
}

export const Slot = React.forwardRef<HTMLElement, AnyProps & { children?: React.ReactNode }>(
  ({ children, ...slotProps }, ref) => {
    if (React.isValidElement(children)) {
      const child = children as React.ReactElement<AnyProps> & { ref?: React.Ref<HTMLElement> };
      return React.cloneElement(child, {
        ...mergeProps(slotProps, child.props),
        ref: ref ? mergeRefs([ref, child.ref]) : child.ref,
      });
    }
    if (process.env.NODE_ENV !== 'production' && React.Children.count(children) > 1) {
      console.warn('Slot: expected a single React element child.');
    }
    return null;
  },
);
Slot.displayName = 'Slot';
