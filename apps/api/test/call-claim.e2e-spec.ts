// The claim race on real Postgres (the unit spec only sees the WHERE clauses): ten agents pressing Answer at once on
// one ringing call, exactly one wins; then the release, the answer and the end, each a compare-and-set that a second
// try loses. Runs in the e2e suite (CI pushes the schema first); it needs no app.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@multiwa/database';
import { claimCall, markAnswered, markEnded, reconcileAfterRestart, releaseClaim } from '../src/modules/calls/coordinator/call-session-store';

describe('call claims (e2e, real Postgres)', () => {
  const tag = `claim-${Date.now()}`;
  let organizationId = '';
  let profileId = '';
  let agents: string[] = [];
  let seq = 0;
  const ringing = () => prisma.call.create({ data: { profileId, waCallId: `${tag}-${++seq}`, fromJid: '628111000111@c.us' } });

  beforeAll(async () => {
    const org = await prisma.organization.create({ data: { name: tag, slug: tag } });
    organizationId = org.id;
    const workspace = await prisma.workspace.create({ data: { organizationId, name: 'W', slug: 'w' } });
    profileId = (await prisma.profile.create({ data: { workspaceId: workspace.id, displayName: 'Line 1' } })).id;
    agents = [];
    for (let i = 0; i < 10; i++) {
      const u = await prisma.user.create({ data: { organizationId, email: `${tag}-${i}@example.com`, passwordHash: 'x', name: `Agent ${i}` } });
      agents.push(u.id);
    }
  });
  afterAll(async () => {
    await prisma.organization.delete({ where: { id: organizationId } }); // cascades to its users, profiles and calls
  });

  it('ten agents answering at once: exactly one claims the call', async () => {
    const call = await ringing();
    const won = await Promise.all(agents.map((u) => claimCall(call.id, u)));
    expect(won.filter(Boolean)).toHaveLength(1);
    expect((await prisma.call.findUnique({ where: { id: call.id } }))!.answeredByUserId).toBe(agents[won.indexOf(true)]);
  });

  it('release, answer and end: each needs the state before it, and a second try loses', async () => {
    const call = await ringing();
    const [a, b] = agents;
    expect(await claimCall(call.id, a)).toBe(true);
    expect(await releaseClaim(call.id, b)).toBe(false); // not b's
    expect(await releaseClaim(call.id, a)).toBe(true);
    expect(await claimCall(call.id, b)).toBe(true); // ringing again, claimable again
    expect(await markAnswered(call.id, a, new Date())).toBeNull(); // a's claim is gone
    const answered = await markAnswered(call.id, b, new Date(Date.now() - 65_000));
    expect(answered).toMatchObject({ outcome: 'answered', answeredByUserId: b, followUp: 'done' });
    expect(await releaseClaim(call.id, b)).toBe(false); // an answered call keeps its agent
    const ended = await markEnded(call.id, 'agent', 'hangup', new Date());
    expect(ended).toMatchObject({ endedBy: 'agent', endReason: 'hangup' });
    expect(ended!.talkSeconds).toBeGreaterThanOrEqual(64);
    expect(await markEnded(call.id, 'caller', 'caller_hangup', new Date())).toBeNull();
  });

  it("boot reconciliation: an answered call left open is ended, a claim left on a call that stopped ringing is released", async () => {
    const open = await ringing();
    await claimCall(open.id, agents[0]);
    await markAnswered(open.id, agents[0], new Date(Date.now() - 30_000));
    const stale = await ringing();
    await claimCall(stale.id, agents[1]);
    await prisma.call.update({ where: { id: stale.id }, data: { outcome: 'unknown' } }); // the boot sweep closed it
    const { ended, released } = await reconcileAfterRestart(new Date());
    expect(ended).toBeGreaterThanOrEqual(1);
    expect(released).toBeGreaterThanOrEqual(1);
    expect(await prisma.call.findUnique({ where: { id: open.id } })).toMatchObject({ endedBy: 'server', endReason: 'server_restart' });
    expect((await prisma.call.findUnique({ where: { id: stale.id } }))!.answeredByUserId).toBeNull();
  });
});
