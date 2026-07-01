# Contributing to MultiWA

First off, thank you for considering contributing to MultiWA! It's people like you that make MultiWA such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by the [MultiWA Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead**
- **Include logs if possible**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Explain why this enhancement would be useful**

### Pull Requests

All changes — including those by maintainers — land through a Pull Request.
The `main` branch is protected: direct pushes are rejected, and every PR must
pass the Release Gate CI and receive a review before it can be merged.

**Workflow**

1. Create a topic branch off `main`. Use a descriptive prefix:
   - `feat/<slug>` — new functionality
   - `fix/<slug>` — bug fix
   - `docs/<slug>` — documentation only
   - `chore/` · `refactor/` · `test/<slug>` — everything else
2. Keep the change focused — one logical change per PR.
3. Add or update tests for the behavior you change.
4. If you touch an API route, update the docs and route snapshot (see
   [Release Checks](#release-checks)).
5. Run the checks locally before pushing:
   `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm check:release`.
6. Write [Conventional Commit](https://www.conventionalcommits.org/) messages,
   e.g. `fix(engine): resolve canonical group id before sending`.
7. Self-review your diff, then open the PR and fill in the template.
8. **Link the issues your PR resolves** by putting `Closes #<number>` (or
   `Fixes #<number>`) in the PR description. Referenced issues close
   automatically when the PR merges — please don't close them by hand.
9. A maintainer reviews and merges. Squash-merge is preferred to keep the
   `main` history linear and readable.

> First time contributing? `git clone` your fork, then follow
> [Development Setup](#development-setup).

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/multiwa.git
cd multiwa

# Install dependencies
pnpm install

# Start development
pnpm dev
```

## Release Checks

Before opening a pull request, run the release gate locally. The same checks
run in CI via `.github/workflows/release-gate.yml`.

```bash
# Composite gate: whitespace check, public boundary scan, API contract check
pnpm check:release
```

Individual checks:

```bash
pnpm check:public-boundary   # secret / private-IP / conflict-marker scan
pnpm check:api-contract      # source vs snapshot vs docs/07-api-specification.md
```

### When you change an API route

If you add, rename, remove, or change a method on any
`apps/api/src/**/*.controller.ts`, update **both** of these in the same
commit:

1. `docs/07-api-specification.md` — add or update the table row using the
   exact shape:

   ```markdown
   | `METHOD` | `/path` | Short description |
   ```

   Path parameters may be written as `:id` or `{id}`; both are accepted.

2. The route snapshot:

   ```bash
   pnpm check:api-contract:update
   ```

   This refreshes `scripts/api-routes.snapshot.json` from the current
   controller decorators. Commit the regenerated snapshot together with the
   docs and code change.

Controllers carrying `@ApiExcludeController()` (or methods carrying
`@ApiExcludeEndpoint()`) are intentionally excluded from the public API
surface and therefore from both the snapshot and the docs.

If the gate is failing locally, the error output lists exactly which routes
are missing from the snapshot or from the docs, plus the recovery command.
No live server, Swagger fetch, or credential is required for any of these
checks.

## Project Structure

```
multiwa/
├── apps/
│   ├── api/          # NestJS API backend
│   └── admin/        # Next.js admin dashboard
├── packages/
│   ├── database/     # Prisma schema & migrations
│   ├── engines/      # WhatsApp engine adapters
│   ├── sdk/          # TypeScript SDK
│   ├── sdk-python/   # Python SDK
│   └── sdk-php/      # PHP SDK
└── docs/             # Documentation
```

## Coding Style

- Use TypeScript for all new code
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Write tests for new features

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
