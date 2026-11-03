// MultiWA Gateway - the agents' call commands (/ws)
// apps/api/src/modules/calls/calls.gateway.ts
//
// On the same Socket.IO namespace as EventsGateway, which authenticates every socket and puts it in its user's room:
// this gateway only answers the call:* commands, each one acked { ok: true, … } or { ok: false, reason }. The
// coordinator re-checks the user's role and organization on every command.
import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { EventsGateway, WS_GATEWAY_OPTIONS, type SocketPrincipal } from '../events/events.gateway';
import { CallSessionService } from './coordinator/call-session.service';

// CodeQL js/log-injection: only `.replace(/[\r\n]/g, '')` counts as a sanitizer.
const clean = (s: unknown) => String(s).replace(/[\r\n]/g, '');

type Body = Record<string, unknown> | undefined;

@WebSocketGateway(WS_GATEWAY_OPTIONS)
export class CallsGateway {
  private readonly logger = new Logger(CallsGateway.name);

  constructor(
    private readonly events: EventsGateway,
    private readonly sessions: CallSessionService,
  ) {}

  @SubscribeMessage('call:answer')
  answer(@ConnectedSocket() client: Socket, @MessageBody() body: Body) {
    return this.as(client, 'call:answer', (p) => this.sessions.answer(p, body?.callId));
  }

  @SubscribeMessage('call:media')
  media(@ConnectedSocket() client: Socket, @MessageBody() body: Body) {
    return this.as(client, 'call:media', (p) => this.sessions.media(p, body?.callId, body?.op, body));
  }

  @SubscribeMessage('call:rejoin')
  rejoin(@ConnectedSocket() client: Socket, @MessageBody() body: Body) {
    return this.as(client, 'call:rejoin', (p) => this.sessions.rejoin(p, body?.callId, body?.ifProducerId));
  }

  @SubscribeMessage('call:hangup')
  hangup(@ConnectedSocket() client: Socket, @MessageBody() body: Body) {
    return this.as(client, 'call:hangup', (p) => this.sessions.hangup(p, body?.callId));
  }

  @SubscribeMessage('call:availability')
  availability(@ConnectedSocket() client: Socket, @MessageBody() body: Body) {
    return this.as(client, 'call:availability', (p) => this.sessions.setAvailability(p, body?.available));
  }

  /**
   * Run a command as the socket's principal. Every command is answered: not_allowed without one, error when it throws.
   * A socket whose credentials could not be checked (the database is down) has none either, and answers unavailable, as
   * its join answers Unavailable: it is closed for a retry, so the command is to be sent again after the next connect.
   * A not_allowed would read as final, and an error as a command that failed, with no reconnect to come.
   */
  private async as<T>(client: Socket, command: string, run: (principal: SocketPrincipal) => Promise<T>): Promise<T | { ok: false; reason: string }> {
    const principal = await this.events.authOf(client);
    if (!principal) return { ok: false, reason: client.data.authUnchecked ? 'unavailable' : 'not_allowed' };
    try {
      return await run(principal);
    } catch (e) {
      this.logger.warn(`${command} failed: ${clean((e as Error)?.message ?? e)}`);
      return { ok: false, reason: 'error' };
    }
  }
}
