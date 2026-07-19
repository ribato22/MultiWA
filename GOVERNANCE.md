# Governance

MultiWA is an open-source project under the MIT license. This document describes
how decisions are made and how the project is maintained.

## Roles

- **Maintainer** — has merge rights, sets direction, cuts releases, and reviews
  security reports. The current maintainer is [@ribato22](https://github.com/ribato22).
- **Contributor** — anyone who opens an issue or a pull request. No formal
  membership is required.

## Decision-making

- Day-to-day changes are decided by the maintainer through PR review.
- Larger or breaking changes should start as a GitHub issue or discussion so the
  design can be agreed before implementation.
- The maintainer has final say; disagreements are resolved through discussion,
  favoring the project's stability, security, and public/self-host user base.

## Contribution flow

1. Open an issue describing the change (or claim an existing one).
2. Fork, branch (see [CONTRIBUTING.md](./CONTRIBUTING.md) for conventions), and
   open a PR. All changes ship via PR — never direct-to-`main`.
3. CI must pass; a maintainer reviews and merges.

## Releases

Releases are tagged from `main` and follow [Semantic Versioning](https://semver.org).
User-facing changes are recorded in [CHANGELOG.md](./CHANGELOG.md). SDK packages
and container images are published via the workflows documented in
[docs/21-releasing-and-distribution.md](./docs/21-releasing-and-distribution.md).

## Becoming a maintainer

Sustained, high-quality contributions may lead to an invitation to co-maintain.
This is at the discretion of the current maintainer.

## Code of Conduct

All participation is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).
