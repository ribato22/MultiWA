// MultiWA Gateway API - App Module
// apps/api/src/app.module.ts

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DemoGuard } from './common/guards/demo.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TenantModule } from './common/tenant/tenant.module';
import { AuthModule } from './modules/auth/auth.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { MessagesModule } from './modules/messages/messages.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { EngineCommandsModule } from './modules/engine-commands/engine-commands.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { AutomationModule } from './modules/automation/automation.module';
import { AutoreplyModule } from './modules/autoreply/autoreply.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { EventsModule } from './modules/events/events.module';
import { HealthController } from './health.controller';
import { RootController } from './root.controller';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AIModule } from './modules/ai/ai.module';
import { SettingsModule } from './modules/settings/settings.module';

// Infrastructure modules
import { CacheModule } from './modules/cache/cache.module';
import { PluginsModule } from './modules/plugins/plugins.module';

// Third-party integrations
import { IntegrationsModule } from './modules/integrations/integrations.module';

// Competitive parity modules
import { GroupsModule } from './modules/groups/groups.module';
import { BulkModule } from './modules/bulk/bulk.module';
import { MetricsModule } from './metrics/metrics.module';
// Realtime is served by the single authenticated EventsGateway (modules/events).

@Module({
  imports: [
    // Prometheus metrics at GET /metrics (default runtime metrics)
    MetricsModule,
    // Rate limiting — global default; tighten per-route with @Throttle()
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    // Cross-tenant ownership guard (opt-in per route via @RequireTenant)
    TenantModule,
    // API -> worker engine command client (active only when ENGINE_HOST=worker)
    EngineCommandsModule,
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    
    // Task scheduling
    ScheduleModule.forRoot(),

    // Application event bus (consumed by the plugin loader and any @OnEvent
    // listener). Previously provided by the now-removed global HooksModule; the
    // legacy /hooks webhook registry was a cross-tenant global store and has been
    // deprecated in favour of the org-scoped WebhooksModule (/webhooks).
    // The ONE and only EventEmitterModule.forRoot in the app (PluginsModule must
    // not register a second one — see plugins.module.ts). Consumed by the plugin
    // loader and the webhook dispatcher @OnEvent listeners.
    EventEmitterModule.forRoot({
      wildcard: true,        // Allow 'message.*' patterns
      delimiter: '.',         // Event namespace delimiter
      maxListeners: 50,       // plugin loader + webhook dispatcher + @OnEvent listeners
      verboseMemoryLeak: true,
    }),

    // Infrastructure modules
    CacheModule,       // Config-driven cache (Redis/Memory)
    PluginsModule,     // Plugin loader (scans plugins/ directory)
    
    // Third-party integrations
    IntegrationsModule, // TypeBot + Chatwoot connectors
    
    // Feature modules
    AuthModule,
    AccountsModule,
    OrganizationsModule,
    WorkspacesModule,
    ProfilesModule,
    MessagesModule,
    WebhooksModule,
    ContactsModule,
    ConversationsModule,
    TemplatesModule,
    BroadcastModule,
    AutomationModule,
    AutoreplyModule,
    AIModule,
    
    // Enterprise modules
    RbacModule,
    AuditModule,
    NotificationsModule,
    StatisticsModule,
    ApiKeysModule,
    SettingsModule,
    
    // Infrastructure modules
    UploadsModule,
    
    // Real-time events (WebSocket)
    EventsModule,
    
    // Competitive parity modules
    GroupsModule,      // Full group management API
    BulkModule,        // Bulk messaging with variables
  ],
  controllers: [RootController, HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: DemoGuard,
    },
  ],
})
export class AppModule {}
