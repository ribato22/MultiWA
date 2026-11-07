// MultiWA Gateway API - Profiles Module
// apps/api/src/modules/profiles/profiles.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { REALTIME_EMITTER } from '@multiwa/core';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { EngineManagerService } from './engine-manager.service';
import { EventsGateway } from '../events/events.gateway';
import { AutomationModule } from '../automation/automation.module';
import { MessagesModule } from '../messages/messages.module';
import { CallRecordingsModule } from '../calls/recordings/call-recordings.module';

@Module({
  imports: [
    forwardRef(() => AutomationModule),
    // EngineManagerService sends the auto-reject reply of a call through MessagesService (send gate);
    // MessagesModule imports this module back, hence forwardRef on both sides.
    forwardRef(() => MessagesModule),
    CallRecordingsModule,
  ],
  controllers: [ProfilesController],
  providers: [
    ProfilesService,
    EngineManagerService,
    // In the API, the engine emits realtime events straight to Socket.IO.
    // EventsGateway (global) satisfies the RealtimeEmitter interface.
    { provide: REALTIME_EMITTER, useExisting: EventsGateway },
  ],
  exports: [ProfilesService, EngineManagerService],
})
export class ProfilesModule {}
