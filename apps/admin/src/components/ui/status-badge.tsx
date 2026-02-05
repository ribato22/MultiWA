// MultiWA - Status Badge Component
// apps/admin/src/components/ui/status-badge.tsx

import { cn } from "@/lib/utils";

export type StatusType = 'online' | 'offline' | 'connecting' | 'error';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  pulse?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig = {
  online: {
    bg: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-400',
    bgLight: 'bg-emerald-100 dark:bg-emerald-900/30',
    label: 'Connected',
  },
  offline: {
    bg: 'bg-gray-400',
    text: 'text-gray-700 dark:text-gray-400',
    bgLight: 'bg-gray-100 dark:bg-gray-800',
    label: 'Disconnected',
  },
  connecting: {
    bg: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
    bgLight: 'bg-amber-100 dark:bg-amber-900/30',
    label: 'Connecting...',
  },
  error: {
    bg: 'bg-red-500',
    text: 'text-red-700 dark:text-red-400',
    bgLight: 'bg-red-100 dark:bg-red-900/30',
    label: 'Error',
  },
};

const sizeConfig = {
  sm: {
    dot: 'w-2 h-2',
    text: 'text-xs',
    padding: 'px-2 py-0.5',
  },
  md: {
    dot: 'w-2.5 h-2.5',
    text: 'text-sm',
    padding: 'px-2.5 py-1',
  },
  lg: {
    dot: 'w-3 h-3',
    text: 'text-base',
    padding: 'px-3 py-1.5',
  },
};

export function StatusBadge({ 
  status, 
  label, 
  pulse = true, 
  className,
  size = 'md'
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const sizes = sizeConfig[size];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-medium rounded-full",
        config.bgLight,
        config.text,
        sizes.padding,
        sizes.text,
        className
      )}
    >
      <span 
        className={cn(
          "rounded-full flex-shrink-0",
          config.bg,
          sizes.dot,
          pulse && status === 'online' && 'animate-online',
          status === 'connecting' && 'animate-pulse'
        )} 
      />
      {label || config.label}
    </span>
  );
}

// Dot-only version for compact displays
export function StatusDot({ 
  status, 
  pulse = true,
  className 
}: { 
  status: StatusType; 
  pulse?: boolean;
  className?: string;
}) {
  const config = statusConfig[status];

  return (
    <span 
      className={cn(
        "w-2.5 h-2.5 rounded-full inline-block",
        config.bg,
        pulse && status === 'online' && 'animate-online',
        status === 'connecting' && 'animate-pulse',
        className
      )} 
    />
  );
}
