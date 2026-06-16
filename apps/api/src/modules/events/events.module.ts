// MultiWA Gateway - Events Module
// apps/api/src/modules/events/events.module.ts

import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';
import { RealtimeBridgeService } from './realtime-bridge.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [EventsGateway, RealtimeBridgeService],
  exports: [EventsGateway],
})
export class EventsModule {}
