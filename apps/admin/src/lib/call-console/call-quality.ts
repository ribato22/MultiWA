// The call's network quality for the in-call bar, from the WebRTC stats the agent's browser reads every 2 s.
export type Quality = 'good' | 'fair' | 'poor';

/** Round trip and jitter in ms, loss in % of the packets since the last sample; a field the stats lack is absent. */
export interface LinkSample {
  rttMs?: number;
  jitterMs?: number;
  lossPct?: number;
}

// ponytail: fixed limits for a voice call (Opus hides a little loss); tune them from real calls if agents disagree.
const LIMITS: Record<keyof LinkSample, [fair: number, poor: number]> = { rttMs: [250, 500], jitterMs: [30, 60], lossPct: [2, 5] };

/** The worst of the three, or null before a sample has any of them. */
export function quality(sample: LinkSample): Quality | null {
  let worst = -1;
  for (const key of Object.keys(LIMITS) as (keyof LinkSample)[]) {
    const value = sample[key];
    if (value == null) continue;
    const [fair, poor] = LIMITS[key];
    worst = Math.max(worst, value > poor ? 2 : value > fair ? 1 : 0);
  }
  return worst < 0 ? null : (['good', 'fair', 'poor'] as const)[worst];
}
