'use client';

import Link from 'next/link';
import { Monitor, Copy, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Button } from '@/components/ui/button';

interface DesktopOnlyGuardProps {
  pageName: string;
  reason: string;
  minWidth?: 'md' | 'lg';
  children: React.ReactNode;
}

/**
 * Renders children only at >= minWidth. Below that, shows a "best on desktop"
 * card with the page name, reason, and a Copy-link CTA.
 *
 * SSR default: assume desktop so children render server-side without flashing
 * the guard card.
 */
export function DesktopOnlyGuard({
  pageName,
  reason,
  minWidth = 'md',
  children,
}: DesktopOnlyGuardProps) {
  const query = minWidth === 'lg' ? '(min-width: 1024px)' : '(min-width: 768px)';
  const isWide = useMediaQuery(query, /* ssrDefault */ true);
  const [copied, setCopied] = useState(false);

  if (isWide) return <>{children}</>;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard API blocked — fail silently
    }
  };

  return (
    <div className="flex items-center justify-center py-16 px-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Monitor className="w-8 h-8" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Best on desktop
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {pageName} — {reason}
        </p>
        <div className="space-y-2">
          <Button
            onClick={handleCopy}
            variant="outline"
            className="w-full gap-2 cursor-pointer"
          >
            <Copy className="w-4 h-4" aria-hidden="true" />
            {copied ? 'Link copied' : 'Copy this link'}
          </Button>
          <Link href="/dashboard" className="block">
            <Button variant="ghost" className="w-full gap-2 cursor-pointer">
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
