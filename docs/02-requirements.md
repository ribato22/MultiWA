# 02 - Requirements

## System Requirements

### Minimum
| Component | Requirement |
|-----------|-------------|
| CPU | 2 cores |
| RAM | 2 GB |
| Storage | 10 GB SSD |
| OS | Ubuntu 20.04+, Debian 11+, macOS, Windows WSL2 |

### Recommended (Production)
| Component | Requirement |
|-----------|-------------|
| CPU | 4+ cores |
| RAM | 4+ GB |
| Storage | 50+ GB SSD |
| Network | Static IP, open ports 80/443 |

---

## Software Dependencies

### Runtime
- **Node.js** 20 LTS or higher
- **pnpm** 8.0+ (package manager)
- **PostgreSQL** 14+ (database)
- **Redis** 7+ (cache & queues)

### Development
- **Docker** 24+ (containerization)
- **Docker Compose** v2 (orchestration)
- **Git** (version control)

---

## Port Configuration

| Service | Port | Description |
|---------|------|-------------|
| API | 3001 | REST API + WebSocket |
| Admin | 3000 | Admin Dashboard |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache |

---

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/multiwa
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-32-char-jwt-secret-here

# Optional
OPENAI_API_KEY=sk-...           # For AI features
STORAGE_TYPE=local              # local | s3
S3_BUCKET=multiwa-uploads       # If using S3
S3_REGION=ap-southeast-1
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
```

---

[← Project Overview](./01-project-overview.md) · [Documentation Index](./README.md) · [Quick Start →](./03-quick-start.md)
