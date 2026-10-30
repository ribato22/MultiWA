// MultiWA Gateway - one call's media room on the call media server
// apps/api/src/modules/calls/media/call-media-room.ts
//
// A mediasoup Router with two peers. The "page" peer is the WhatsApp Web page's media bridge; it produces the
// caller and consumes the agent. The "agent" peer is the agent's browser; it produces the agent and consumes the
// caller. Each peer has at most one send and one receive transport, produces at most one track, and may consume only
// the other peer's track, so a client can never reach another peer's or another call's media. A peer's signalling runs
// one operation at a time, so these limits hold for calls made together too. Closing a peer (closePeer) voids every
// operation it had issued before, also one still at the worker, so that the peer can join again.
// The signalling API speaks mediasoup's JSON: `signalingFor(peer)` binds it to one peer.
import type { types as ms } from 'mediasoup';
import type { CallMediaSignaling } from '@multiwa/engines';

export type MediaPeer = 'page' | 'agent';
export type MediaRole = 'caller' | 'agent';
/** What each peer produces, and what it may consume. */
const PRODUCES: Record<MediaPeer, MediaRole> = { page: 'caller', agent: 'agent' };
const CONSUMES: Record<MediaPeer, MediaRole> = { page: 'agent', agent: 'caller' };

export class CallMediaRoom {
  private readonly transports = new Map<string, { peer: MediaPeer; direction: 'send' | 'recv'; transport: ms.WebRtcTransport }>();
  private readonly producers: Partial<Record<MediaRole, ms.Producer>> = {};
  private readonly consumers = new Map<string, { peer: MediaPeer; consumer: ms.Consumer }>();
  /** Where each peer's signalling operations queue (see `run`). The two peers are independent of each other. */
  private readonly chains: Record<MediaPeer, Promise<unknown>> = { page: Promise.resolve(), agent: Promise.resolve() };
  /** Counts each peer's closePeer calls: an operation issued under an older count belongs to a peer that was closed. */
  private readonly generations: Record<MediaPeer, number> = { page: 0, agent: 0 };
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
  producerId(role: MediaRole): string | null {
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
      createTransport: (direction) => this.run(peer, (generation) => this.createTransport(peer, generation, direction)),
      connectTransport: (transportId, dtlsParameters) =>
        this.run(peer, () => this.connectTransport(peer, transportId, dtlsParameters as ms.DtlsParameters)),
      produce: (transportId, kind, rtpParameters) =>
        this.run(peer, (generation) => this.produce(peer, generation, transportId, kind, rtpParameters as ms.RtpParameters)),
      consume: (transportId, producerId, rtpCapabilities) =>
        this.run(peer, (generation) => this.consume(peer, generation, transportId, producerId, rtpCapabilities as ms.RtpCapabilities)),
      resumeConsumer: (consumerId) => this.run(peer, async () => this.ownConsumer(peer, consumerId).resume()),
      closeConsumer: (consumerId) => this.run(peer, async () => this.ownConsumer(peer, consumerId).close()),
    };
  }

  /**
   * Run `op` once the peer's earlier operations are done. Every limit is checked before an `await` and recorded after
   * it, so concurrent calls would all pass the check: one operation at a time per peer makes check and record atomic.
   * A failed operation does not stop the next one. The chain never rejects, so `then(op)` is enough.
   * `op` gets the peer's generation as of the moment it was ISSUED, not of its turn: an operation that waits in the chain
   * while the peer is closed was issued by the peer that was closed, and must not run as the next one's.
   */
  private run<T>(peer: MediaPeer, op: (generation: number) => Promise<T>): Promise<T> {
    const generation = this.generations[peer];
    const result = this.chains[peer].then(() => op(generation));
    this.chains[peer] = result.catch(() => undefined);
    return result;
  }

  /** Close the room: every transport, producer and consumer, and its router. Idempotent. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    // Router.close() never tells the WebRtcServer that its transports are gone, so the server would keep all of them
    // (some 27 KiB a call) for the life of the process: close them first.
    for (const { transport } of this.transports.values()) transport.close();
    this.transports.clear();
    this.router.close();
    this.onClose();
  }

  private async createTransport(peer: MediaPeer, generation: number, direction: 'send' | 'recv') {
    this.assertCurrent(peer, generation);
    if (direction !== 'send' && direction !== 'recv') throw new Error('A transport is send or recv');
    if ([...this.transports.values()].some((t) => t.peer === peer && t.direction === direction)) {
      throw new Error(`The ${peer} already has a ${direction} transport`);
    }
    const transport = await this.keepIfCurrent(peer, generation, () =>
      this.router.createWebRtcTransport({ webRtcServer: this.server, enableUdp: true, enableTcp: true, preferUdp: true }),
    );
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

  private async produce(peer: MediaPeer, generation: number, transportId: string, kind: string, rtpParameters: ms.RtpParameters): Promise<{ id: string }> {
    this.assertCurrent(peer, generation);
    const { transport } = this.own(peer, transportId, 'send');
    if (kind !== 'audio') throw new Error('Audio only');
    const role = PRODUCES[peer];
    if (this.producers[role]) throw new Error(`The ${role} is already produced`);
    const producer = await this.keepIfCurrent(peer, generation, () => transport.produce({ kind: 'audio', rtpParameters, appData: { role } }));
    this.producers[role] = producer;
    // A closed producer (its transport closed: closePeer, a dropped agent) can be produced again.
    producer.observer.once('close', () => {
      if (this.producers[role] === producer) delete this.producers[role];
    });
    return { id: producer.id };
  }

  /**
   * Close every transport of `peer`, and with them its producer and consumers, so that it can join again: e.g. an
   * agent whose browser reconnected (the coordinator's agent-lost grace). Immediate. No operation the peer issued before
   * can stand in the way of its next join. One that makes a transport, producer or consumer, still waiting in its chain
   * or already at the worker, fails with "The ${peer} was closed" and keeps nothing it made. One on a transport or
   * consumer acts on what is closed now: still waiting, it fails; already at the worker, it may still complete.
   */
  closePeer(peer: MediaPeer): void {
    this.generations[peer]++;
    for (const [id, t] of [...this.transports]) {
      if (t.peer !== peer) continue;
      this.transports.delete(id);
      t.transport.close();
    }
  }

  private async consume(peer: MediaPeer, generation: number, transportId: string, producerId: string, rtpCapabilities: ms.RtpCapabilities) {
    this.assertCurrent(peer, generation);
    const { transport } = this.own(peer, transportId, 'recv');
    const producer = this.producers[CONSUMES[peer]];
    if (!producer || producer.id !== producerId) throw new Error('Not allowed to consume this producer');
    // One live consumer per peer: the page's own scripts can reach the bridge's signalling, and the worker is shared.
    if ([...this.consumers.values()].some((c) => c.peer === peer)) throw new Error(`The ${peer} already consumes`);
    if (!this.router.canConsume({ producerId, rtpCapabilities })) throw new Error('Cannot consume this producer with these capabilities');
    const consumer = await this.keepIfCurrent(peer, generation, () => transport.consume({ producerId, rtpCapabilities, paused: true }));
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

  /** The room is open, and the peer was not closed (closePeer) since `generation`, when the operation was issued. */
  private assertCurrent(peer: MediaPeer, generation: number): void {
    this.assertOpen();
    if (this.generations[peer] !== generation) throw new Error(`The ${peer} was closed`);
  }

  /**
   * Run `create`, which makes a transport, producer or consumer at the worker, and hand it back only if the room is still
   * open and the peer was not closed meanwhile. Else close it and refuse: closing the room or the peer could not know
   * it yet, so it would stay at the worker (the WebRtcServer keeps a transport) or be registered, and block the peer's
   * next join ("already has a send transport", "is already produced", "already consumes").
   */
  private async keepIfCurrent<T extends { close(): void }>(peer: MediaPeer, generation: number, create: () => Promise<T>): Promise<T> {
    const made = await create();
    try {
      this.assertCurrent(peer, generation);
    } catch (e) {
      made.close();
      throw e;
    }
    return made;
  }
}
