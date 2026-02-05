# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| Latest  | ✅ Yes             |
| < 1.0   | ❌ No              |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **DO NOT** open a public issue
2. Email us at **security@multiwa.dev** or open a private security advisory on GitHub
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (optional)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 7 days
- **Fix**: Within 30 days (critical issues prioritized)

### What to Expect

- We will acknowledge your report promptly
- We will investigate and validate the issue
- We will develop and test a fix
- We will credit you (unless you prefer anonymity) in the release notes

## Security Best Practices for Self-Hosters

### Required
- Change all default passwords in `.env.production`
- Generate strong `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `ENCRYPTION_KEY`
- Use HTTPS in production (SSL/TLS termination via Nginx)
- Keep Docker images updated

### Recommended
- Enable 2FA for admin accounts
- Use a firewall to restrict database/Redis access
- Regular backups of PostgreSQL data
- Monitor audit logs for suspicious activity
- Use Docker secrets for sensitive environment variables

## Encryption

MultiWA encrypts sensitive settings (SMTP passwords, S3 keys, VAPID keys) at rest using AES-256-GCM with the `ENCRYPTION_KEY` environment variable.

```bash
# Generate a secure encryption key
openssl rand -hex 32
```
