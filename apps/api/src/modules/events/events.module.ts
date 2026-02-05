// MultiWA Gateway - Events Module
// apps/api/src/modules/events/events.module.ts

import { Module, Global } from '@nestjs/common';
import { EventsGateway } from './events.gateway';

@Global()
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
