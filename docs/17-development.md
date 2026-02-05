# 17 - Development Guide

## Setup Development Environment

```bash
# Clone repository
git clone https://github.com/ribato22/multiwa.git
cd multiwa

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env

# Start PostgreSQL and Redis
docker compose up -d db redis

# Run migrations
pnpm prisma migrate dev

# Start development servers
pnpm dev
```

---

## Project Structure

```
multiwa/
├── apps/
│   ├── api/                # NestJS Backend
│   │   ├── src/
│   │   │   ├── modules/    # Feature modules
│   │   │   ├── common/     # Shared utilities
│   │   │   └── main.ts
│   │   └── Dockerfile
│   └── admin/              # Next.js Dashboard
│       ├── app/
│       ├── components/
│       └── Dockerfile
├── packages/
│   ├── prisma/             # Database schema
│   ├── sdk-python/         # Python SDK
│   └── sdk-php/            # PHP SDK
├── docs/                   # Documentation
└── docker-compose.yml
```

---

## Adding a New Module

1. Create module directory:
```bash
mkdir -p apps/api/src/modules/myfeature
```

2. Create files:
```
myfeature/
├── dto/
│   └── index.ts
├── myfeature.controller.ts
├── myfeature.service.ts
└── myfeature.module.ts
```

3. Register in `app.module.ts`:
```typescript
import { MyFeatureModule } from './modules/myfeature/myfeature.module';

@Module({
  imports: [..., MyFeatureModule],
})
```

---

## Testing

```bash
# Unit tests
pnpm test

# E2E tests
pnpm test:e2e

# Coverage
pnpm test:cov
```

---

## Code Style

- **ESLint** + **Prettier** for formatting
- **Conventional Commits** for commit messages

```bash
# Lint
pnpm lint

# Format
pnpm format
```

---

## Pull Request Checklist

- [ ] Tests pass (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Docs updated if needed
- [ ] Conventional commit message

---

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev servers |
| `pnpm build` | Build production |
| `pnpm prisma studio` | Open Prisma Studio |
| `pnpm prisma migrate dev` | Run migrations |
| `pnpm test` | Run tests |

---

[← Docker Deployment](./16-deployment-docker.md) · [Documentation Index](./README.md)
