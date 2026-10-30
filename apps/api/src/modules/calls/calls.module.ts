// MultiWA Gateway - Calls Module
// apps/api/src/modules/calls/calls.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { REALTIME_EMITTER } from '@multiwa/core';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallMediaService } from './media/call-media.service';
import { EventsGateway } from '../events/events.gateway';
import { ProfilesModule } from '../profiles/profiles.module';
import { MessagesModule } from '../messages/messages.module';

// EventsModule and EngineCommandsModule are @Global (EventsGateway, EngineCommandsService); the event bus comes from
// the app-wide EventEmitterModule.
@Module({
  // EngineManagerService (ProfilesModule) and MessagesService (MessagesModule) are exported; the two import each
  // other, hence forwardRef.
  imports: [forwardRef(() => ProfilesModule), forwardRef(() => MessagesModule)],
  controllers: [CallsController],
  providers: [
    CallsService,
    CallMediaService,
    // The token CallsService pushes call.updated to Socket.IO through. ProfilesModule binds it too, but does not
    // export it, so it is not visible here.
    { provide: REALTIME_EMITTER, useExisting: EventsGateway },
  ],
  exports: [CallMediaService],
})
export class CallsModule {}
