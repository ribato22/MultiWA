---
sidebar_position: 6
title: "Releasing & Distribution"
---

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
| `multiwa/multiwa-php` (PHP) | Packagist | `split-sdk-php.yml` → mirror repo | tag `sdk-php-v*` | ⚠️ one PAT (`SPLIT_REPO_TOKEN`); Packagist itself via webhook |
| WordPress plugin | WordPress.org | _deferred_ (needs review) | — | ❌ SVN user/pass |

---

## npm — TypeScript SDK (`@multiwa/sdk`)

**One-time (maintainer):**
1. Create/own the `@multiwa` org on npmjs.com (free plan → unlimited public
   packages). Confirm the scope is free: `npm view @multiwa/sdk`. If taken,
   rename the package (e.g. `@ribato22/multiwa-sdk`) in `packages/sdk/package.json`.
2. Enable 2FA (auth-and-writes) on the npm account.
3. **Trusted Publishing** (in place since 1.3.0): npmjs.com → @multiwa/sdk →
   Settings → **Trusted Publisher** → GitHub Actions, `ribato22` / `MultiWA`,
   workflow `publish-sdk.yml`, no environment, **Allow npm publish** (stage
   publish is always allowed; dist-tag is not needed). The repository holds no npm
   token. A new connection must publish once within 48 hours to be validated, and
   a run started before the connection was saved fails: re-run it afterwards.

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

Same model as the TS SDK: a Trusted Publisher for `publish-n8n-node.yml` (its own
connection on the `n8n-nodes-multiwa` package), no token. Once live on npm it is installable via n8n → Settings →
Community Nodes; optionally submit it to n8n's verified-node program.

**Each release:** bump the package version, `git tag n8n-v<version> && git push origin n8n-v<version>`.

## Packagist — PHP SDK (`multiwa/multiwa-php`)

Packagist reads `composer.json` from a **repository root**, but the SDK lives in
`packages/sdk-php` of this monorepo. `split-sdk-php.yml` therefore mirrors that
directory to the read-only repo `ribato22/multiwa-php`, and Packagist watches the
mirror. On a `sdk-php-v<version>` tag the workflow runs
`git subtree split --prefix=packages/sdk-php`, pushes the result to the mirror's
`main`, and tags it there as `v<version>`. `composer.json` has no `version`
field: the tag is the version. `sdk-php.yml` validates, analyses and tests the
package on PHP 8.1–8.4 for every change to it.

**One-time (maintainer):**
1. Create the public repository `ribato22/multiwa-php`, **empty** (no README,
   license or .gitignore), so the first split push lands cleanly. Treat it as
   read-only: every change goes through `packages/sdk-php` here.
2. Create a fine-grained personal access token with access to **only**
   `ribato22/multiwa-php` and the permission **Contents: Read and write**, and
   add it to this repository as the Actions secret `SPLIT_REPO_TOKEN`. It is the
   only long-lived secret in the release setup (`GITHUB_TOKEN` cannot push to
   another repository); without it the workflow stops with an error naming it.
3. Push the first tag (below). The mirror then has `composer.json` at its root
   and the tag `v1.3.0`.
4. Submit `https://github.com/ribato22/multiwa-php` on packagist.org (**Submit**).
5. Enable auto-update: log in to packagist.org with GitHub and grant the
   Packagist application access, so it installs its push webhook on the mirror
   (the package page warns while it is missing). Each new tag then appears on
   Packagist without a token in this repository.

**Each release:** the version comes from the tag only, so there is nothing to
bump: `git tag sdk-php-v<version> && git push origin sdk-php-v<version>`
(the first release is `sdk-php-v1.3.0`; SDK versions follow the project version).

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
