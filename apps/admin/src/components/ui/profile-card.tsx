// MultiWA - Profile Card Component
// apps/admin/src/components/ui/profile-card.tsx

'use client';

import { Plug, Power, Eye, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusType } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelative, formatFull } from "@/lib/datetime";

interface ProfileCardProps {
  id: string;
  name: string;
  phone?: string;
  avatar?: string;
  status: StatusType;
  messageCount?: number;
  lastActive?: string;
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onView?: (id: string) => void;
  className?: string;
  loading?: boolean;
}

export function ProfileCard({
  id,
  name,
  phone,
  avatar,
  status,
  messageCount = 0,
  lastActive,
  onConnect,
  onDisconnect,
  onView,
  className,
  loading = false,
}: ProfileCardProps) {
  if (loading) {
    return (
      <div className={cn(
        "bg-card rounded-2xl p-6 border border-border",
        className
      )}>
        <div className="flex items-start gap-4">
          <Skeleton className="w-14 h-14 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-4 mt-6 pt-4 border-t border-border">
          <Skeleton className="h-9 flex-1 rounded-lg" />
          <Skeleton className="h-9 flex-1 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "bg-card rounded-2xl p-6 border border-border hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5",
      "group",
      className
    )}>
      {/* Header */}
      <div className="flex items-start gap-4">
        <Avatar className="w-14 h-14 border-2 border-border">
          <AvatarImage src={avatar} alt={name} />
          <AvatarFallback className="bg-primary/10 text-primary font-semibold text-lg">
            {name?.charAt(0)?.toUpperCase() || 'W'}
          </AvatarFallback>
        </Avatar>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate group-hover:text-primary transition-colors">
            {name}
          </h3>
          {phone && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {phone}
            </p>
          )}
        </div>
        
        <StatusBadge status={status} size="sm" />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 mt-4 text-sm">
        <div>
          <span className="font-semibold text-foreground">{messageCount.toLocaleString()}</span>
          <span className="text-muted-foreground ml-1">messages</span>
        </div>
        {lastActive && (
          <div className="text-muted-foreground" title={formatFull(lastActive)}>
            Last active: {formatRelative(lastActive)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
        {status === 'offline' ? (
          <Button
            className="flex-1 gap-2 cursor-pointer"
            onClick={() => onConnect?.(id)}
          >
            <Plug className="w-4 h-4" aria-hidden="true" />
            Connect
          </Button>
        ) : status === 'online' ? (
          <Button
            variant="outline"
            className="flex-1 gap-2 cursor-pointer"
            onClick={() => onDisconnect?.(id)}
          >
            <Power className="w-4 h-4" aria-hidden="true" />
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" className="flex-1 gap-2" disabled>
            <Loader2 className="w-4 h-4 mw-spin" aria-hidden="true" />
            Connecting...
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          onClick={() => onView?.(id)}
          className="flex-shrink-0 cursor-pointer"
          aria-label={`View ${name} details`}
        >
          <Eye className="w-5 h-5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// Grid container helper
export function ProfileGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6",
      className
    )}>
      {children}
    </div>
  );
}
