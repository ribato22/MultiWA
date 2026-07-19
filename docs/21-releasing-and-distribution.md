# Releasing & Distribution

How MultiWA's artifacts get published, and the one-time setup each registry needs.

The repo ships **keyless** publish automation wherever the registry supports it
(GitHub OIDC → npm Trusted Publishing, PyPI Trusted Publishing, Sigstore cosign,
GitHub build-provenance) so **no long-lived tokens** live in the repo in steady
state. Each SDK versions independently via a **dedicated tag prefix**, decoupled
from the monorepo-wide `v*` GitHub Release (`.github/workflows/release.yml`).

| Artifact | Registry | Workflow | Release trigger | Keyless? |
|---|---|---|---|---|
| `@multiwa/sdk` (TS) | npm | `publish-sdk.yml` | tag `sdk-v*` | ✅ OIDC + provenance |
| `multiwa` (Python) | PyPI | `publish-sdk-python.yml` | tag `sdk-python-v*` | ✅ Trusted Publishing |
| `n8n-nodes-multiwa` | npm | `publish-n8n-node.yml` | tag `n8n-v*` | ✅ OIDC + provenance |
| api / admin / worker images | GHCR (+ Docker Hub) | `docker-publish.yml` | GitHub Release / dispatch | ✅ cosign + SLSA provenance |
| `multiwa/multiwa-php` (PHP) | Packagist | _deferred_ (needs split repo) | tag `v*` | GitHub App webhook |
| WordPress plugin | WordPress.org | _deferred_ (needs review) | — | ❌ SVN user/pass |

---

## npm — TypeScript SDK (`@multiwa/sdk`)

**One-time (maintainer):**
1. Create/own the `@multiwa` org on npmjs.com (free plan → unlimited public
   packages). Confirm the scope is free: `npm view @multiwa/sdk`. If taken,
   rename the package (e.g. `@ribato22/multiwa-sdk`) in `packages/sdk/package.json`.
2. Enable 2FA (auth-and-writes) on the npm account.
3. **Bootstrap the first publish** (OIDC can only attach to a package that already
   exists): create a Granular Access Token scoped to `@multiwa/*` with publish
   rights, add it as the repo secret `NPM_TOKEN`. The workflow's `NODE_AUTH_TOKEN`
   fallback uses it for the first release.
4. After the package exists, switch to keyless: npmjs.com → @multiwa/sdk →
   Settings → **Trusted Publishing** → add a GitHub Actions publisher for
   `ribato22/MultiWA`, workflow `publish-sdk.yml`. Then delete `NPM_TOKEN`.

**Each release:** bump `version` in `packages/sdk/package.json`, then
`git tag sdk-v<version> && git push origin sdk-v<version>`.

## PyPI — Python SDK (`multiwa`)

**One-time (maintainer):**
1. Confirm `multiwa` is free at https://pypi.org/project/multiwa/. If taken,
   rename `name` in `pyproject.toml` (e.g. `multiwa-sdk`).
2. Create a PyPI account + enable 2FA.
3. Add a **pending** Trusted Publisher (project doesn't exist yet): PyPI →
   Account → Publishing → *Add a pending publisher* → Publisher=GitHub,
   Owner=`ribato22`, Repo=`MultiWA`, Workflow=`publish-sdk-python.yml`,
   Environment=`pypi`.
4. Create the GitHub Actions environment `pypi` (Settings → Environments). No
   secrets — OIDC mints the token.

**Each release:** bump `version` in `pyproject.toml` +
`multiwa/__init__.py`, then `git tag sdk-python-v<version> && git push origin sdk-python-v<version>`.

## npm — n8n community node (`n8n-nodes-multiwa`)

Same model as the TS SDK (Trusted Publisher for `publish-n8n-node.yml`, or
`NPM_TOKEN` bootstrap). Once live on npm it is installable via n8n → Settings →
Community Nodes; optionally submit it to n8n's verified-node program.

**Each release:** bump the package version, `git tag n8n-v<version> && git push origin n8n-v<version>`.

## Docker images (GHCR primary, Docker Hub optional)

`docker-publish.yml` now builds **api, admin, and worker**, and for every image
emits an **SBOM**, a **max-mode SLSA provenance** attestation, a **keyless cosign
signature**, and a **GitHub build-provenance** attestation — all via OIDC, no
stored key.

**One-time (maintainer):**
- **GHCR visibility:** after the first publish, set each package
  (`multiwa-api/admin/worker`) to **Public** and connect it to the repo — GHCR
  defaults to private, so public `docker pull` fails until flipped.
- **Docker Hub (optional):** add a Read/Write token as repo secret
  `DOCKERHUB_TOKEN`; without it the Docker Hub push silently no-ops (the README
  pulls badge then points at images that were never pushed). Note: Docker Hub may
  reject the OCI referrer attestations — if a push fails, publish attestations to
  GHCR only.

**Verify a signed image:**
```bash
cosign verify ghcr.io/ribato22/multiwa-api:latest \
  --certificate-identity-regexp 'https://github.com/ribato22/MultiWA/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/ribato22/multiwa-api:latest --owner ribato22
```

## One-click deploy (Render)

`render.yaml` is a Render Blueprint provisioning Postgres + Key Value (Redis,
`noeviction`) + api/admin/worker from the GHCR images. See the header of
`render.yaml` for the three values you confirm at deploy time (public images,
`ENCRYPTION_KEY` via `openssl rand -hex 32`, and the admin's public API URL).

---

## Deferred (need external infrastructure — separate follow-up)

### Packagist — PHP SDK (`multiwa/multiwa-php`)
Packagist reads `composer.json` from a **repo root**, but the SDK lives in
`packages/sdk-php` of this JS monorepo, so the monorepo URL cannot be submitted.
Path to publish:
1. Create a standalone read-only repo (e.g. `ribato22/multiwa-php`).
2. Add a **subtree-split** workflow (`split-sdk-php.yml`, on `v*`) that pushes
   `packages/sdk-php` + the semver tag to that repo. It needs a fine-grained PAT
   with `contents:write` on the split repo as `SPLIT_REPO_TOKEN` (the only
   long-lived secret — `GITHUB_TOKEN` can't push cross-repo).
3. Submit the standalone repo once on packagist.org and install the **Packagist
   GitHub App** on it (secretless auto-update on every tag).
4. Also fix the README error-handling example, which references
   `MultiWA\Exceptions\*` classes that don't exist yet.

### WordPress.org plugin directory
No OIDC/keyless path exists. Requires a **one-time manual Plugins Team review**
of a submitted ZIP, then per-plugin SVN with `SVN_USERNAME`/`SVN_PASSWORD`
secrets and a `10up/action-wordpress-plugin-deploy` workflow. Blockers to clear
first: add a compliant `readme.txt` (Stable tag, Tested up to, Requires at least,
License URI) and complete the `multiwa.php` header. Slug must not imply
"whatsapp" (a Meta trademark) — request `multiwa`.

### arm64 multi-arch images
Deferred pending validation that the Chromium/Puppeteer install in the
Dockerfiles builds cleanly under `linux/arm64` (QEMU). Once verified, add
`docker/setup-qemu-action` + `platforms: linux/amd64,linux/arm64`.
