# Public Release Checklist

Maintainer-facing checklist for cutting a public MultiWA release. Run
through it in order; the release gate workflow at
[`.github/workflows/release-gate.yml`](../.github/workflows/release-gate.yml)
enforces the most important items automatically, but this list captures
everything that needs human attention.

## 1. Code and Docs Gate

- [ ] Working tree clean (`git status` shows no unintended modifications).
- [ ] `git diff --check` exits 0 — no whitespace errors, no conflict
      markers.
- [ ] `pnpm check:public-boundary` exits 0. No hard-fail findings.
- [ ] `pnpm check:api-contract` exits 0. Source, snapshot, and
      `docs/07-api-specification.md` table rows agree.
- [ ] `pnpm check:release` (composite) exits 0.
- [ ] If any controller changed in this release, the snapshot was
      refreshed via `pnpm check:api-contract:update` and the docs table
      row was added or updated in the same commit.
- [ ] No internal-only file is tracked (the workflow checks this; run
      `git ls-files | grep -E 'findings|progress|task_plan|architecture/|\\.tmp/'`
      to mirror it locally).

## 2. SDK Build and Tests

- [ ] `pnpm --filter @multiwa/sdk build` exits 0 with **no warnings**.
- [ ] `pnpm --filter @multiwa/sdk test` exits 0. All vitest cases pass.
- [ ] `npm pack --dry-run` inside `packages/sdk/` lists the expected
      files: `LICENSE`, `README.md`, `dist/index.{d.mts, d.ts, js, mjs}`,
      `package.json`.
- [ ] `python -m tomllib` parses `packages/sdk-python/pyproject.toml`
      cleanly. If a build host with `pip`/`build`/`twine` is available,
      also run `python -m build` and `twine check dist/*`.
- [ ] `composer validate --strict` from `packages/sdk-php/` reports the
      manifest is valid.

## 3. Version Consistency

- [ ] Every `package.json` in the workspace lists the same version.
- [ ] `packages/sdk-python/pyproject.toml` `version = "..."` matches.
- [ ] `packages/sdk-php/composer.json` has no stale `version` field, or
      matches the tag if present.
- [ ] README version badge matches.
- [ ] `CHANGELOG.md` has a section for the new version with a date and
      itemized changes.

## 4. README Snippet Audit

- [ ] The TypeScript SDK example uses `MultiWAClient` (not `MultiWA`)
      and `client.messages.sendText(...)` (not `client.messages.send`).
- [ ] Every code example uses the `/api/v1` prefix.
- [ ] Docker examples use `http://localhost:3333` (port 3333).
- [ ] Local-dev examples use `http://localhost:3000` (port 3000).
- [ ] No SDK install snippet implies a registry release that has not
      actually happened. Published packages use their real install command
      (TypeScript: `npm install @multiwa/sdk`; Python: `pip install multiwa`;
      n8n node: `npm install n8n-nodes-multiwa`). SDKs still awaiting a
      registry (PHP `multiwa/sdk`) must say "Included in repository · registry
      publishing pending."

## 5. Docker Quick Start Smoke Test

On a clean working copy:

```bash
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA
cp .env.docker .env
docker compose up -d
docker ps --filter name=multiwa --format '{{.Names}}\t{{.Status}}'
curl -fsSI http://127.0.0.1:3333/api/docs
curl -fsSI http://127.0.0.1:3001/
```

- [ ] Five `multiwa-*` containers running.
- [ ] API docs return HTTP 200.
- [ ] Admin returns HTTP 200.

## 6. Demo Asset

- [ ] A demo recording is optional for the release. If one ships, it
      lives under `docs/screenshots/` with a release-tagged name (for
      example `docs/screenshots/demo-v<version>.webp`).
- [ ] If a fresh recording was made for this release, it follows
      [`docs/demo-capture.md`](demo-capture.md): localhost only, phone
      numbers and QR redacted, no internal hostnames, no real
      credentials. Placeholder or work-in-progress recordings must not
      be committed.
- [ ] The screenshots referenced by the root README (`logo.png`,
      `dashboard.png`, `chat.png`, `broadcast.png`, `analytics.png`) all
      exist on disk and render on github.com.
- [ ] No broken image references in the root README (each `<img src>`
      target exists in the repo).

## 7. Release Tag and Notes

- [ ] Tag follows `v<MAJOR>.<MINOR>.<PATCH>` (matches CHANGELOG header).
- [ ] Release notes summarize the CHANGELOG section for this version.
- [ ] Release notes do not include internal hostnames, IPs, or
      operational details.
- [ ] Docker Hub publish workflow has the required secrets set (if a
      Docker image will publish on tag).

## 8. Post-Release Verification

- [ ] The new tag triggers the `Release Gate` workflow on GitHub Actions
      and it goes green.
- [ ] If Docker publish ran, `docker pull ribato/multiwa-api:<tag>` works
      from a clean machine.
- [ ] If SDK registry publish ran (NPM / PyPI / Packagist), the package
      page resolves and shows the correct README. Update the SDK README
      install sections to remove the "publishing pending" disclaimers in
      a follow-up PR.

---

## What this checklist does **not** cover

- Private/internal server deployment. Any such flow lives in
  internal-only notes (gitignored) and is not part of the public release.
- Internal credential rotation, hardening of the live server, or any
  operational task tied to a specific deployment.
- Marketing or social posts. Treat the README and the CHANGELOG as the
  source of truth for what changed.
