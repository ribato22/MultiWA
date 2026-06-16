// MultiWA Gateway API - Profiles Module
// apps/api/src/modules/profiles/profiles.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { REALTIME_EMITTER } from '@multiwa/core';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { EngineManagerService } from './engine-manager.service';
import { EventsGateway } from '../events/events.gateway';
import { AutomationModule } from '../automation/automation.module';

@Module({
  imports: [
    forwardRef(() => AutomationModule),
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
