// MultiWA Gateway - Engine host feature flag
// apps/api/src/common/engine-host.ts
//
// ENGINE_HOST selects where the WhatsApp engine runs:
//   'api'    (default, unset) — engine lives in the API process (current behaviour)
//   'worker' — engine lives in apps/worker; the API delegates engine operations
//              to the worker over BullMQ and relays realtime via Redis pub/sub.
// All call sites branch at runtime via isWorkerEngine(); default keeps the API path.

export const ENGINE_HOST_DEFAULT = 'api';

export function isWorkerEngine(): boolean {
  return process.env.ENGINE_HOST === 'worker';
}
