// MultiWA Gateway - Calls Module
// apps/api/src/modules/calls/calls.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { REALTIME_EMITTER } from '@multiwa/core';
import { CallsController } from './calls.controller';
import { ProfileCallsController } from './profile-calls.controller';
import { CallsService } from './calls.service';
import { CallMediaService } from './media/call-media.service';
import { CallSessionService } from './coordinator/call-session.service';
import { CallAlerts } from './coordinator/call-alerts';
import { CallsGateway } from './calls.gateway';
import { EventsGateway } from '../events/events.gateway';
import { ProfilesModule } from '../profiles/profiles.module';
import { MessagesModule } from '../messages/messages.module';
import { CallRecordingsModule } from './recordings/call-recordings.module';

// EventsModule and EngineCommandsModule are @Global (EventsGateway, EngineCommandsService); the event bus comes from
// the app-wide EventEmitterModule.
@Module({
  // EngineManagerService (ProfilesModule) and MessagesService (MessagesModule) are exported; the two import each
  // other, hence forwardRef.
  imports: [forwardRef(() => ProfilesModule), forwardRef(() => MessagesModule), CallRecordingsModule],
  controllers: [CallsController, ProfileCallsController],
  providers: [
    CallsService,
    CallMediaService,
    CallSessionService,
    CallAlerts,
    CallsGateway,
    // The token CallsService and the coordinator push call.updated (and the dashboard answer's events) to Socket.IO
    // through. ProfilesModule binds it too, but does not export it, so it is not visible here.
    { provide: REALTIME_EMITTER, useExisting: EventsGateway },
  ],
  exports: [CallMediaService],
})
export class CallsModule {}
