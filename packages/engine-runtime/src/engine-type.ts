// packages/engine-runtime/src/engine-type.ts
//
// Resolve which engine adapter a profile should use, with a safe fallback chain:
//   profile.engine (if valid) → DEFAULT_ENGINE env (if valid) → whatsapp-web-js.
// Emits a warning for the experimental Baileys engine.
//
// Shared between apps/api and apps/worker so both engine-managers resolve the
// engine type identically; see architecture/engine-worker-migration-sop.md.

import type { EngineType } from '@multiwa/engines';

const VALID_ENGINES: EngineType[] = ['whatsapp-web-js', 'baileys', 'mock'];

export interface ResolveEngineTypeDeps {
  /** Value of the DEFAULT_ENGINE env var (pass process.env.DEFAULT_ENGINE). */
  defaultEngine?: string | null;
  /** Sink for fallback/experimental warnings (pass a logger.warn). */
  warn?: (message: string) => void;
}

export function resolveEngineType(
  engineField: string | null | undefined,
  deps: ResolveEngineTypeDeps = {},
): EngineType {
  const warn = deps.warn ?? (() => {});
  let selected: EngineType;

  if (engineField && VALID_ENGINES.includes(engineField as EngineType)) {
    selected = engineField as EngineType;
  } else {
    const envDefault = deps.defaultEngine;
    if (envDefault && VALID_ENGINES.includes(envDefault as EngineType)) {
      if (engineField) {
        warn(`Profile engine '${engineField}' invalid; falling back to DEFAULT_ENGINE='${envDefault}'`);
      }
      selected = envDefault as EngineType;
    } else {
      if (engineField) {
        warn(`Profile engine '${engineField}' is not a known engine; defaulting to whatsapp-web-js`);
      }
      selected = 'whatsapp-web-js';
    }
  }

  if (selected === 'baileys') {
    warn(
      'Profile is using the EXPERIMENTAL Baileys engine — sendReaction is a no-op stub and getContacts may be unavailable. Use whatsapp-web-js for production.',
    );
  }
  return selected;
}
