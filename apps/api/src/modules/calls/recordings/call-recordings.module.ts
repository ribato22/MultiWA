// MultiWA Gateway - Call recordings module
// apps/api/src/modules/calls/recordings/call-recordings.module.ts
//
// The private recordings storage and what reads and deletes from it. A module of its own, so that ProfilesModule and
// AccountsModule (which delete profiles, and with them their recordings) can import it without CallsModule.
import { Module } from '@nestjs/common';
import { CallAnnouncementService } from './call-announcement.service';
import { CallRecordingsService } from './call-recordings.service';
import { RECORDING_STORE, createRecordingStore } from './recording-store';

@Module({
  providers: [
    // From the environment (ConfigModule has loaded .env by then). A missing or wrong setting gives a store whose
    // `problem` says so, and the API starts all the same: recording cannot be turned on.
    { provide: RECORDING_STORE, useFactory: () => createRecordingStore(process.env) },
    CallRecordingsService,
    CallAnnouncementService,
  ],
  exports: [RECORDING_STORE, CallRecordingsService, CallAnnouncementService],
})
export class CallRecordingsModule {}
