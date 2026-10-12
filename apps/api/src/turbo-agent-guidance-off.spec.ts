// turbo agent-guidance opt-out guard.
//
// turbo 2.11 maintains a managed block in the repository-root AGENTS.md whenever it
// detects an AI coding agent, and refreshes it before every repository-scoped command.
// `pnpm build`, `typecheck`, `dev` and `test` all go through turbo. The block showed up
// in a working tree the first time an agent ran `pnpm typecheck` after the turbo
// 2.10 -> 2.11 bump.
//
// Why that matters here: AGENTS.md is the tracked, public file that carries this
// repository's attribution policy. A vendor-written block that announces "when an AI
// agent is detected" and tells the agent to keep it committed does two things this repo
// does not want. It dirties the working tree on every agent run, and it puts
// agent-specific text into a public file as a side effect of running a build.
//
// The only repo-level switch is `"agentGuidance": false` in the ROOT turbo.json. turbo's
// docs list no environment variable or CLI flag for it; it is root-only, and it does not
// remove a block that is already there.
//
// Nothing else notices it going missing. CI is not an agent, so a turbo.json that has
// lost the flag builds green and the block quietly returns on the next local agent run.
//
// Note the flag needs turbo >= 2.11: older versions reject it with
// `turbo_json_parse_error`. The repo's turbo spec is ^2.11.7, so a fresh install is
// always fine; only a stale node_modules fails, loudly, until `pnpm install` is run.

import { readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const TURBO_JSON = path.join(__dirname, '..', '..', '..', 'turbo.json');

describe('turbo.json', () => {
  it('opts out of the managed AGENTS.md block', () => {
    const turbo = JSON.parse(readFileSync(TURBO_JSON, 'utf8'));
    expect(
      turbo.agentGuidance,
      'turbo.json must set "agentGuidance": false. Without it, turbo >= 2.11 writes an ' +
        'AI-agent block into the tracked AGENTS.md whenever an agent runs a turbo command.',
    ).toBe(false);
  });
});
