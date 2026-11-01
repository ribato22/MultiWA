// The icon of each call outcome, for every place that shows one: a new outcome is a type error here.
import { Phone, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOff, type LucideIcon } from 'lucide-react';
import type { CallOutcome } from '@/lib/api';
import { knownOutcome } from '@/lib/calls';

const OUTCOME_ICON: Record<CallOutcome, LucideIcon> = {
  answered: PhoneCall,
  ringing: PhoneIncoming,
  rejected: PhoneOff,
  answered_elsewhere: Phone,
  missed: PhoneMissed,
  unknown: PhoneMissed,
};

/** An outcome this admin does not know yet has the unknown outcome's icon. */
export const outcomeIcon = (outcome: CallOutcome): LucideIcon => OUTCOME_ICON[knownOutcome(outcome)];
