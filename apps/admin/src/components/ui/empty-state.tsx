// MultiWA - Empty State Component
// apps/admin/src/components/ui/empty-state.tsx

import {
  Smartphone,
  MessageCircle,
  Users,
  Megaphone,
  Zap,
  Webhook as WebhookIcon,
  Search,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  /** The title's heading: h3 inside a page, h1 when the empty state is the page. */
  titleAs?: 'h1' | 'h2' | 'h3';
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  secondaryAction?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  className?: string;
}

// Default icons for common empty states. Each renders a Lucide icon sized for
// the EmptyState container (which provides the surrounding circle + padding).
export const EmptyStateIcons = {
  profiles:   <Smartphone   className="w-10 h-10" aria-hidden="true" />,
  messages:   <MessageCircle className="w-10 h-10" aria-hidden="true" />,
  contacts:   <Users        className="w-10 h-10" aria-hidden="true" />,
  broadcasts: <Megaphone    className="w-10 h-10" aria-hidden="true" />,
  automation: <Zap          className="w-10 h-10" aria-hidden="true" />,
  webhooks:   <WebhookIcon  className="w-10 h-10" aria-hidden="true" />,
  search:     <Search       className="w-10 h-10" aria-hidden="true" />,
  error:      <AlertTriangle className="w-10 h-10" aria-hidden="true" />,
};

export function EmptyState({
  icon,
  title,
  titleAs: Title = 'h3',
  description,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-16 px-4 text-center animate-fade-in",
      className
    )}>
      {/* Icon Container */}
      {icon && (
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-6">
          {icon}
        </div>
      )}

      {/* Title */}
      <Title className="text-xl font-semibold text-foreground mb-2">
        {title}
      </Title>

      {/* Description */}
      {description && (
        <p className="text-muted-foreground max-w-md mb-6">
          {description}
        </p>
      )}

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action && (
            action.href ? (
              <Button asChild className="cursor-pointer">
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ) : (
              <Button onClick={action.onClick} className="cursor-pointer">
                {action.label}
              </Button>
            )
          )}
          {secondaryAction && (
            secondaryAction.href ? (
              <Button asChild variant="outline" className="cursor-pointer">
                <Link href={secondaryAction.href}>{secondaryAction.label}</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={secondaryAction.onClick} className="cursor-pointer">
                {secondaryAction.label}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// Preset empty states for common scenarios
export function EmptyProfiles() {
  return (
    <EmptyState
      icon={EmptyStateIcons.profiles}
      title="No WhatsApp profiles yet"
      description="Connect your first WhatsApp device to start sending messages."
      action={{
        label: "Add Profile",
        href: "/dashboard/profiles/new",
      }}
    />
  );
}

export function EmptyMessages() {
  return (
    <EmptyState
      icon={EmptyStateIcons.messages}
      title="No messages yet"
      description="Start a conversation or wait for incoming messages."
      action={{
        label: "Send Message",
        href: "/dashboard/messages",
      }}
    />
  );
}

export function EmptyContacts() {
  return (
    <EmptyState
      icon={EmptyStateIcons.contacts}
      title="No contacts yet"
      description="Add contacts manually or import from a CSV file."
      action={{
        label: "Add Contact",
        href: "/dashboard/contacts/new",
      }}
      secondaryAction={{
        label: "Import CSV",
        href: "/dashboard/contacts/import",
      }}
    />
  );
}

export function EmptySearchResults({ query }: { query: string }) {
  return (
    <EmptyState
      icon={EmptyStateIcons.search}
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try a different search term.`}
    />
  );
}
