# Database Backup & Restore Guide

This guide covers database backup and restoration procedures for MultiWA Gateway.

## PostgreSQL Backup

### Method 1: Using Docker Compose

```bash
# Backup
docker compose exec postgres pg_dump -U multiwa multiwa_gateway > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
cat backup_20260202_120000.sql | docker compose exec -T postgres psql -U multiwa multiwa_gateway
```

### Method 2: Using pg_dump Directly

```bash
# Full backup with compression
pg_dump -h localhost -U multiwa -d multiwa_gateway -F c -f backup.dump

# Restore
pg_restore -h localhost -U multiwa -d multiwa_gateway backup.dump
```

### Method 3: Automated Daily Backup Script

Create `/scripts/backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="multiwa_backup_${DATE}.sql.gz"

# Create backup
docker compose exec -T postgres pg_dump -U multiwa multiwa_gateway | gzip > "${BACKUP_DIR}/${FILENAME}"

# Keep only last 7 days
find ${BACKUP_DIR} -name "multiwa_backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: ${FILENAME}"
```

Add to crontab for daily backup at 2 AM:
```bash
0 2 * * * /path/to/scripts/backup.sh >> /var/log/multiwa-backup.log 2>&1
```

## Redis Backup

Redis data is used for caching and job queues. For persistent data:

```bash
# Trigger RDB snapshot
docker compose exec redis redis-cli BGSAVE

# Copy dump file
docker compose cp redis:/data/dump.rdb ./redis_backup.rdb
```

## Session Data Backup

WhatsApp session data is stored in `/data/sessions`:

```bash
# Backup sessions
tar -czf sessions_backup.tar.gz -C /data sessions/

# Restore sessions
tar -xzf sessions_backup.tar.gz -C /data
```

## Full Backup Strategy

For production, implement a 3-2-1 backup strategy:
- **3** copies of data
- **2** different storage media
- **1** offsite backup

### Recommended Tools
- **pgBackRest** - PostgreSQL backup with incremental support
- **Restic** - Encrypted backups to cloud storage (S3, MinIO)
- **Velero** - Kubernetes-native backup (for K8s deployments)

## Disaster Recovery

1. **Stop services**: `docker compose down`
2. **Restore PostgreSQL**: Use pg_restore or psql
3. **Restore Redis RDB**: Copy dump.rdb to Redis data volume
4. **Restore sessions**: Extract session backup to sessions directory
5. **Start services**: `docker compose up -d`
6. **Verify**: Check logs and test connectivity
