// MultiWA Gateway - one call's media room on the call media server
// apps/api/src/modules/calls/media/call-media-room.ts
//
// A mediasoup Router with two peers. The "page" peer is the WhatsApp Web page's media bridge; it produces the
// caller and consumes the agent. The "agent" peer is the agent's browser; it produces the agent and consumes the
// caller. Each peer has at most one send and one receive transport, produces exactly one track, and may consume only
// the other peer's track, so a client can never reach another peer's or another call's media. A peer's signalling runs
// one operation at a time, so these limits hold for calls made together too.
// The signalling API speaks mediasoup's JSON: `signalingFor(peer)` binds it to one peer.
import type { types as ms } from 'mediasoup';
import type { CallMediaSignaling } from '@multiwa/engines';

export type MediaPeer = 'page' | 'agent';
type Role = 'caller' | 'agent';
/** What each peer produces, and what it may consume. */
const PRODUCES: Record<MediaPeer, Role> = { page: 'caller', agent: 'agent' };
const CONSUMES: Record<MediaPeer, Role> = { page: 'agent', agent: 'caller' };

export class CallMediaRoom {
  private readonly transports = new Map<string, { peer: MediaPeer; direction: 'send' | 'recv'; transport: ms.WebRtcTransport }>();
  private readonly producers: Partial<Record<Role, ms.Producer>> = {};
  private readonly consumers = new Map<string, { peer: MediaPeer; consumer: ms.Consumer }>();
  /** Where each peer's signalling operations queue (see `run`). The two peers are independent of each other. */
  private readonly chains: Record<MediaPeer, Promise<unknown>> = { page: Promise.resolve(), agent: Promise.resolve() };
  private isClosed = false;

  constructor(
    readonly callId: string,
    private readonly router: ms.Router,
    private readonly server: ms.WebRtcServer,
    private readonly onClose: () => void,
  ) {
    // A dead worker closes its routers: the room goes with it.
    router.observer.once('close', () => this.close());
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** The producer id of `role`, once produced. */
  producerId(role: Role): string | null {
    return this.producers[role]?.id ?? null;
  }

  /** The signalling API for one peer (the page's media bridge, or the agent's `call:media` socket commands). */
  signalingFor(peer: MediaPeer): CallMediaSignaling {
    return {
      rtpCapabilities: () =>
        this.run(peer, async () => {
          this.assertOpen();
          return this.router.rtpCapabilities;
        }),
      createTransport: (direction) => this.run(peer, () => this.createTransport(peer, direction)),
      connectTransport: (transportId, dtlsParameters) =>
        this.run(peer, () => this.connectTransport(peer, transportId, dtlsParameters as ms.DtlsParameters)),
      produce: (transportId, kind, rtpParameters) =>
        this.run(peer, () => this.produce(peer, transportId, kind, rtpParameters as ms.RtpParameters)),
      consume: (transportId, producerId, rtpCapabilities) =>
        this.run(peer, () => this.consume(peer, transportId, producerId, rtpCapabilities as ms.RtpCapabilities)),
      resumeConsumer: (consumerId) => this.run(peer, async () => this.ownConsumer(peer, consumerId).resume()),
      closeConsumer: (consumerId) => this.run(peer, async () => this.ownConsumer(peer, consumerId).close()),
    };
  }

  /**
   * Run `op` once the peer's earlier operations are done. Every limit is checked before an `await` and recorded after
   * it, so concurrent calls would all pass the check: one operation at a time per peer makes check and record atomic.
   * A failed operation does not stop the next one. The chain never rejects, so `then(op)` is enough.
   */
  private run<T>(peer: MediaPeer, op: () => Promise<T>): Promise<T> {
    const result = this.chains[peer].then(op);
    this.chains[peer] = result.catch(() => undefined);
    return result;
  }

  /** Close the room: its router, and with it every transport, producer and consumer. Idempotent. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.router.close();
    this.onClose();
  }

  private async createTransport(peer: MediaPeer, direction: 'send' | 'recv') {
    this.assertOpen();
    if (direction !== 'send' && direction !== 'recv') throw new Error('A transport is send or recv');
    if ([...this.transports.values()].some((t) => t.peer === peer && t.direction === direction)) {
      throw new Error(`The ${peer} already has a ${direction} transport`);
    }
    const transport = await this.router.createWebRtcTransport({ webRtcServer: this.server, enableUdp: true, enableTcp: true, preferUdp: true });
    this.transports.set(transport.id, { peer, direction, transport });
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  private async connectTransport(peer: MediaPeer, transportId: string, dtlsParameters: ms.DtlsParameters): Promise<void> {
    await this.own(peer, transportId).transport.connect({ dtlsParameters });
  }

  private async produce(peer: MediaPeer, transportId: string, kind: string, rtpParameters: ms.RtpParameters): Promise<{ id: string }> {
    const { transport } = this.own(peer, transportId, 'send');
    if (kind !== 'audio') throw new Error('Audio only');
    const role = PRODUCES[peer];
    if (this.producers[role]) throw new Error(`The ${role} is already produced`);
    const producer = await transport.produce({ kind: 'audio', rtpParameters, appData: { role } });
    this.producers[role] = producer;
    // A closed producer (its transport closed: closePeer, a dropped agent) can be produced again.
    producer.observer.once('close', () => {
      if (this.producers[role] === producer) delete this.producers[role];
    });
    return { id: producer.id };
  }

  /**
   * Close every transport of `peer`, and with them its producer and consumers, so that it can join again: e.g. an
   * agent whose browser reconnected (Plan 4's agent-lost grace).
   */
  closePeer(peer: MediaPeer): void {
    for (const [id, t] of [...this.transports]) {
      if (t.peer !== peer) continue;
      this.transports.delete(id);
      t.transport.close();
    }
  }

  private async consume(peer: MediaPeer, transportId: string, producerId: string, rtpCapabilities: ms.RtpCapabilities) {
    const { transport } = this.own(peer, transportId, 'recv');
    const producer = this.producers[CONSUMES[peer]];
    if (!producer || producer.id !== producerId) throw new Error('Not allowed to consume this producer');
    // One live consumer per peer: the page's own scripts can reach the bridge's signalling, and the worker is shared.
    if ([...this.consumers.values()].some((c) => c.peer === peer)) throw new Error(`The ${peer} already consumes`);
    if (!this.router.canConsume({ producerId, rtpCapabilities })) throw new Error('Cannot consume this producer with these capabilities');
    const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
    this.consumers.set(consumer.id, { peer, consumer });
    consumer.observer.once('close', () => this.consumers.delete(consumer.id));
    return { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters };
  }

  private own(peer: MediaPeer, transportId: string, direction?: 'send' | 'recv') {
    this.assertOpen();
    const t = this.transports.get(transportId);
    if (!t || t.peer !== peer || (direction && t.direction !== direction)) throw new Error("Not this peer's transport");
    return t;
  }

  private ownConsumer(peer: MediaPeer, consumerId: string): ms.Consumer {
    this.assertOpen();
    const c = this.consumers.get(consumerId);
    if (!c || c.peer !== peer) throw new Error("Not this peer's consumer");
    return c.consumer;
  }

  private assertOpen(): void {
    if (this.isClosed) throw new Error('Media room closed');
  }
}
