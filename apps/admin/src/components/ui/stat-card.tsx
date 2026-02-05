// MultiWA - Stat Card Component
// apps/admin/src/components/ui/stat-card.tsx

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: {
    value: number;
    label?: string;
  };
  description?: string;
  className?: string;
  loading?: boolean;
}

export function StatCard({ 
  title, 
  value, 
  icon, 
  trend, 
  description,
  className,
  loading = false
}: StatCardProps) {
  if (loading) {
    return (
      <div className={cn(
        "bg-card rounded-2xl p-6 border border-border",
        className
      )}>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <Skeleton className="h-9 w-24 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  const trendColor = trend 
    ? trend.value >= 0 
      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30' 
      : 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30'
    : '';

  return (
    <div className={cn(
      "bg-card rounded-2xl p-6 border border-border stat-card",
      className
    )}>
      <div className="flex items-center justify-between">
        {icon && (
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xl">
            {icon}
          </div>
        )}
        {trend && (
          <span className={cn(
            "px-2.5 py-1 rounded-full text-xs font-medium",
            trendColor
          )}>
            {trend.value >= 0 ? '+' : ''}{trend.value}%
          </span>
        )}
      </div>
      
      <div className="mt-4">
        <p className="text-3xl font-bold text-foreground">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {title}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground/70 mt-2">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

// Compact version for sidebars
export function StatCardCompact({ 
  title, 
  value, 
  icon,
  className 
}: Pick<StatCardProps, 'title' | 'value' | 'icon' | 'className'>) {
  return (
    <div className={cn(
      "flex items-center gap-3 p-3 rounded-xl bg-secondary/50",
      className
    )}>
      {icon && (
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          {icon}
        </div>
      )}
      <div>
        <p className="text-lg font-semibold text-foreground">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-muted-foreground">{title}</p>
      </div>
    </div>
  );
}
