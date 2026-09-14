# Codex Instructions for MultiWA

@gemini.md

## Shared BLAST Memory

Before making implementation changes, read:

- `task_plan.md` for active phase, gates, and checklist
- `findings.md` for discovery notes and constraints
- `progress.md` for completed work, errors, tests, and blockers

## Collaboration Rules

- Follow the BLAST gates in `gemini.md`.
- Do not create scripts in `tools/` until Blueprint is approved.
- Do not guess business logic. Ask for missing rules and record the answer.
- Update `progress.md` after meaningful work.
- Update `findings.md` when discovering new constraints or research.
- Update `gemini.md` only when schema, behavioral rules, or architectural invariants change.
- Preserve unrelated user changes in the working tree.
- Prefer existing MultiWA patterns in `apps/api`, `apps/admin`, `apps/worker`, and `packages/*`.
