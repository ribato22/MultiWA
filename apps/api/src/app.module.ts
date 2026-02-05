// MultiWA Gateway API - App Module
// apps/api/src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { MessagesModule } from './modules/messages/messages.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
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
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AIModule } from './modules/ai/ai.module';
import { SettingsModule } from './modules/settings/settings.module';

// Infrastructure modules (Sprint 2)
import { CacheModule } from './modules/cache/cache.module';
import { HooksModule } from './modules/hooks/hooks.module';
import { PluginsModule } from './modules/plugins/plugins.module';

// Sprint 4: Third-party integrations
import { IntegrationsModule } from './modules/integrations/integrations.module';

// Competitive parity modules
import { GroupsModule } from './modules/groups/groups.module';
import { BulkModule } from './modules/bulk/bulk.module';
import { WebSocketModule } from './modules/websocket/websocket.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    
    // Task scheduling (Sprint 1: scheduled messages cron)
    ScheduleModule.forRoot(),
    
    // Infrastructure modules (Sprint 2)
    CacheModule,       // Config-driven cache (Redis/Memory)
    HooksModule,       // Event hooks + webhook plugin system
    PluginsModule,     // Plugin loader (scans plugins/ directory)
    
    // Sprint 4: Third-party integrations
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
    WebSocketModule,   // Real-time event subscriptions
  ],
  controllers: [HealthController],
})
export class AppModule {}
