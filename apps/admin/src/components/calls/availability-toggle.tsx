'use client';
// The header's "Available for calls": off, this agent is not rung. During a call the switch gives way to the state.
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCalls } from './calls-provider';

export function AvailabilityToggle() {
  const calls = useCalls();
  if (!calls?.inUse) return null;
  const { availability, active } = calls.state;
  const onCall = !!active && active.phase !== 'ended';
  return (
    <div role="group" aria-label="Calls availability" className="flex items-center gap-2">
      {onCall ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
          On a call
        </span>
      ) : (
        <>
          <Switch
            id="calls-available"
            checked={availability === 'available'}
            disabled={availability === 'offline'}
            onCheckedChange={(on) => calls.setAvailable(on)}
          />
          <Label htmlFor="calls-available" className="cursor-pointer text-xs text-muted-foreground">
            Available for calls
          </Label>
          {availability === 'offline' && <span className="text-xs text-amber-300">Calls offline</span>}
        </>
      )}
    </div>
  );
}
