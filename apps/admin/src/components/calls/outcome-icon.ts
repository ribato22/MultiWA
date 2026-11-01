// The icon of each call outcome, for every place that shows one: a new outcome is a type error here.
import { Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, type LucideIcon } from 'lucide-react';
import type { CallOutcome } from '@/lib/api';

const OUTCOME_ICON: Record<CallOutcome, LucideIcon> = {
  answered: PhoneCall,
  ringing: PhoneIncoming,
  rejected: PhoneOff,
  answered_elsewhere: Phone,
  missed: PhoneMissed,
  unknown: PhoneMissed,
};

/** A newer API can send an outcome this admin does not know yet (the column is plain text): it shows as missed. */
export const outcomeIcon = (outcome: CallOutcome): LucideIcon => OUTCOME_ICON[outcome] ?? PhoneMissed;
