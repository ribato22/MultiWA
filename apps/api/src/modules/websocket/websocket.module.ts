// MultiWA Gateway - WebSocket Module
// apps/api/src/modules/websocket/websocket.module.ts

import { Module, Global } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class WebSocketModule {}
