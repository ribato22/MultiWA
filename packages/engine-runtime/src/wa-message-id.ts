// packages/engine-runtime/src/wa-message-id.ts
//
// Re-export only. The implementation moved to @multiwa/core so that
// packages/engines (the engine adapters — the boundary where the raw engine id
// shapes actually arrive) can use the SAME resolver: engines cannot depend on
// engine-runtime without a dependency cycle, but both may depend on core.
//
// Existing `@multiwa/engine-runtime` importers keep working unchanged.

export { resolveWaMessageId, serializeWaMessageId } from '@multiwa/core';
