// MultiWA Admin - Demo Mode Banner
// apps/admin/src/components/demo-banner.tsx
//
// Renders a slim banner at the top of the page when NEXT_PUBLIC_DEMO_MODE=true.
// Shows a dismissible notification that the instance is read-only.

'use client';

import { useState } from 'react';
import { Gamepad2, X, ArrowRight } from 'lucide-react';

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  if (!isDemoMode || dismissed) return null;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-sm relative z-[100]">
      <div className="max-w-screen-xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1 justify-center">
          <Gamepad2 className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <span className="font-medium text-amber-200">
            Demo Mode — You&apos;re exploring a read-only instance.
          </span>
          <a
            href="https://github.com/ribato22/MultiWA"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-2 font-semibold text-amber-200 hover:text-amber-100 transition-colors"
          >
            Deploy your own
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </a>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 hover:bg-amber-500/20 rounded transition-colors flex-shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          aria-label="Dismiss demo banner"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}