// MultiWA - Profile Card Component
// apps/admin/src/components/ui/profile-card.tsx

'use client';

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusType } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";

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
          <div className="text-muted-foreground">
            Last active: {lastActive}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 mt-6 pt-4 border-t border-border">
        {status === 'offline' ? (
          <Button 
            className="flex-1"
            onClick={() => onConnect?.(id)}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Connect
          </Button>
        ) : status === 'online' ? (
          <Button 
            variant="outline"
            className="flex-1"
            onClick={() => onDisconnect?.(id)}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            Disconnect
          </Button>
        ) : (
          <Button variant="outline" className="flex-1" disabled>
            <svg className="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Connecting...
          </Button>
        )}
        
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => onView?.(id)}
          className="flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
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
