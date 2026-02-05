# Database Options — MultiWA Gateway

MultiWA uses **Prisma ORM** for database access. By default, it's configured for **PostgreSQL**, but you can switch to **SQLite** for simpler deployments.

## Quick Switch

### PostgreSQL (Default)
```env
DATABASE_URL="postgresql://user:pass@localhost:5432/multiwa?schema=public"
```

### SQLite  
```env
DATABASE_URL="file:./data/multiwa.db"
```

> **Note:** After changing `DATABASE_URL`, you must re-initialize the database:
> ```bash
> npx prisma migrate dev
> ```

## Schema Compatibility

The current Prisma schema uses PostgreSQL-specific features. When using SQLite, be aware of these differences:

| Feature | PostgreSQL | SQLite Adjustment |
|---------|-----------|-------------------|
| `@db.Text` | Unlimited text column | Remove annotation (SQLite has flexible types) |
| `Json` type | Native JSONB | Stored as TEXT, auto-serialized by Prisma |
| `DateTime` | Native timestamp | Stored as TEXT (ISO 8601) |
| `@default(uuid())` | ✅ Supported | ✅ Supported (Prisma generates UUID) |
| Array types | `String[]` native | Not supported — use JSON instead |
| Full-text search | `@@fulltext` | Not available |

## Multi-Provider Setup (Experimental)

Prisma supports multi-provider as a preview feature. To enable:

```prisma
// schema.prisma
datasource db {
  provider = "postgresql" // Change to "sqlite" for SQLite
  url      = env("DATABASE_URL")
}
```

> **Important:** You cannot use `provider = ["postgresql", "sqlite"]` in a single schema. Instead, maintain separate branches or use conditional schema generation for each provider.

## Recommended Approach

| Deployment | Database | Why |
|-----------|----------|-----|
| Development / Single-server | SQLite | Zero config, file-based |
| Staging / Production | PostgreSQL | Concurrent connections, JSONB, full-text search |
| Docker Compose | PostgreSQL | Included in docker-compose |

## Migration Between Providers

1. Export data from current database
2. Change `DATABASE_URL` in `.env`
3. Run `npx prisma migrate dev --name switch-provider`
4. Import data to new database

For automated migration scripts, see the Prisma docs on [database seeding](https://www.prisma.io/docs/guides/migrate/seed-database).
