// What an API key with a scope list may reach, by the scopes the dashboard issues. A route lists the scopes that let a
// key through (any of them); the controller's ApiKeyScopeGuard checks them.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { GUARDS_METADATA } from '@nestjs/common/constants';

vi.mock('@multiwa/database', () => ({ prisma: {} }));
vi.mock('../profiles/engine-manager.service', () => ({ EngineManagerService: class {} }));

import { API_KEY_SCOPE } from './decorators/require-scope.decorator';
import { ApiKeyScopeGuard } from './guards/api-key-scope.guard';
import { JwtOrApiKeyGuard } from './guards/jwt-auth.guard';
import { TenantGuard } from '../../common/tenant/tenant.guard';
import { AccountsController } from '../accounts/accounts.controller';
import { BroadcastController } from '../broadcast/broadcast.controller';
import { BulkController } from '../bulk/bulk.controller';
import { ContactsController } from '../contacts/contacts.controller';
import { CustomersController } from '../customers/customers.controller';
import { ConversationsController } from '../conversations/conversations.controller';
import { ProfilesController } from '../profiles/profiles.controller';
import { WebhooksController } from '../webhooks/webhooks.controller';

const scopeOf = (Ctrl: any, name: string) => Reflect.getMetadata(API_KEY_SCOPE, Ctrl.prototype[name]) ?? Reflect.getMetadata(API_KEY_SCOPE, Ctrl);
// The scope guard reads req.user, so it runs after the auth guard: before it, it would let every request through.
const GUARDS = [JwtOrApiKeyGuard, ApiKeyScopeGuard, TenantGuard];

const EXPECTED: Array<[any, Record<string, string[] | undefined>]> = [
  [ContactsController, {
    findAll: ['contacts:read'], findOne: ['contacts:read'], exportCsv: ['contacts:read'], validatePhone: ['contacts:read'], validateBulk: ['contacts:read'],
    create: ['contacts:write'], update: ['contacts:write'], delete: ['contacts:write'], import: ['contacts:write'], importCsv: ['contacts:write'],
    addTags: ['contacts:write'], removeTags: ['contacts:write'], syncFromWhatsApp: ['contacts:write'], saveToWhatsApp: ['contacts:write'], deleteFromWhatsApp: ['contacts:write'],
  }],
  [WebhooksController, {
    findAll: ['webhooks:read'], findOne: ['webhooks:read'],
    create: ['webhooks:write'], update: ['webhooks:write'], delete: ['webhooks:write'], test: ['webhooks:write'],
  }],
  [BroadcastController, {
    findAll: undefined, findOne: undefined, getStats: undefined, getRecipients: undefined,
    create: ['broadcast:write'], update: ['broadcast:write'], delete: ['broadcast:write'], schedule: ['broadcast:write'],
    start: ['broadcast:write'], pause: ['broadcast:write'], resume: ['broadcast:write'], cancel: ['broadcast:write'],
  }],
  [BulkController, { listBatches: undefined, getBatchStatus: undefined, sendBulk: ['broadcast:write'], cancelBatch: ['broadcast:write'] }],
  [ProfilesController, {
    findAll: ['profiles:read'], findOne: ['profiles:read'], status: ['profiles:read'],
    create: ['profiles:write'], update: ['profiles:write'], delete: ['profiles:write'], connect: ['profiles:write'], disconnect: ['profiles:write'],
  }],
  [AccountsController, {
    getProfiles: ['profiles:read'], getProfile: ['profiles:read'], getQr: ['profiles:write'],
    createProfile: ['profiles:write'], deleteProfile: ['profiles:write'], connectProfile: ['profiles:write'], disconnectProfile: ['profiles:write'],
    findAll: undefined, findOne: undefined, create: undefined, update: undefined, remove: undefined,
  }],
  // A conversation's reads answer its messages, as GET /messages/conversation/:id does.
  [ConversationsController, {
    findAll: ['messages:read'], unreadCount: ['messages:read'], findOne: ['messages:read'], getMessages: ['messages:read'],
    markAsRead: ['messages:write'], archive: ['messages:write'], unarchive: ['messages:write'], toggleMute: ['messages:write'],
    togglePin: ['messages:write'], clearMessages: ['messages:write'], delete: ['messages:write'],
  }],
];

describe.each(EXPECTED)('%o', (Ctrl, routes) => {
  it('checks API-key scopes for the whole controller, after sign-in and before the tenant check', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, Ctrl)).toEqual(GUARDS);
  });

  it('asks each route for the scopes the dashboard issues for it', () => {
    expect(Object.fromEntries(Object.keys(routes).map((name) => [name, scopeOf(Ctrl, name)]))).toEqual(routes);
  });
});

// A customer route takes no profile id: the service scopes it to the caller's organization (another organization's id
// answers 404), so the controller has no tenant guard.
describe('CustomersController', () => {
  const READ = ['customers:read'];
  const WRITE = ['customers:write'];
  const ROUTES = {
    list: READ, config: READ, preview: READ, byPhone: READ, findOne: READ, lookup: READ, history: READ, notes: READ,
    setConfig: WRITE, testConfig: WRITE, link: WRITE, useLink: WRITE, unlink: WRITE, update: WRITE, remove: WRITE,
    addNote: WRITE, editNote: WRITE, deleteNote: WRITE,
  };

  it('checks API-key scopes for the whole controller, after sign-in', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CustomersController)).toEqual([JwtOrApiKeyGuard, ApiKeyScopeGuard]);
  });

  it('asks the reads for customers:read and every other route for customers:write', () => {
    expect(Object.fromEntries(Object.keys(ROUTES).map((name) => [name, scopeOf(CustomersController, name)]))).toEqual(ROUTES);
  });
});
