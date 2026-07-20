// Regression guard for the 2026-07-20 production incident: the admin UI stores
// `messages:write` for "Send Messages" (and `messages:read` for "Read Messages"),
// but the MessagesController's @RequireScope had been set to the singular
// `message:send` / `message:read`. The mismatch made EVERY UI-issued API key fail
// to send with 403. This test locks the controller's scope strings to the exact
// values the admin UI issues, so any future drift fails CI instead of production.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { API_KEY_SCOPE } from '../auth/decorators/require-scope.decorator';
import { MessagesController } from './messages.controller';

// Must match apps/admin/src/app/dashboard/api-keys/page.tsx PERMISSIONS values.
const UI_SEND_SCOPE = 'messages:write';
const UI_READ_SCOPE = 'messages:read';

describe('MessagesController API-key scopes match the admin UI convention', () => {
  it('class-level (send) scope is the UI "Send Messages" value', () => {
    const scopes = Reflect.getMetadata(API_KEY_SCOPE, MessagesController);
    expect(scopes).toEqual([UI_SEND_SCOPE]);
  });

  it('every read (GET) route override uses the UI "Read Messages" value, never a singular string', () => {
    const proto = MessagesController.prototype as unknown as Record<string, unknown>;
    const overrides = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .map((name) => Reflect.getMetadata(API_KEY_SCOPE, proto[name] as object))
      .filter((meta): meta is string[] => Array.isArray(meta));

    // At least one route overrides the class default to read.
    expect(overrides.length).toBeGreaterThan(0);
    for (const scopes of overrides) {
      expect(scopes).toEqual([UI_READ_SCOPE]);
    }
  });
});
