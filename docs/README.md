# MultiWA Documentation

Welcome to the MultiWA documentation. MultiWA is a free, open-source WhatsApp API Gateway designed for developers who need full control over their messaging infrastructure.

## 📚 Documentation Index

### Getting Started
- [01 - Project Overview](./01-project-overview.md) - Vision, mission, and architecture
- [02 - Requirements](./02-requirements.md) - System requirements and dependencies
- [03 - Quick Start](./03-quick-start.md) - Get up and running in 5 minutes

### Architecture
- [04 - System Architecture](./04-system-architecture.md) - Technical design and components
- [05 - Database Design](./05-database-design.md) - Prisma schema and relationships
- [06 - Engine Abstraction](./06-engine-abstraction.md) - Baileys and WhatsApp-Web.js adapters

### API Reference
- [07 - API Specification](./07-api-specification.md) - REST API endpoints
- [08 - WebSocket API](./08-websocket-api.md) - Real-time events
- [09 - Webhook Events](./09-webhook-events.md) - Event payloads

### Features
- [10 - Messaging](./10-messaging.md) - Sending messages, media, polls
- [11 - Groups](./11-groups.md) - Group management API
- [12 - Automation](./12-automation.md) - Auto-reply and flow builder

### SDKs & Integrations
- [13 - Python SDK](./13-sdk-python.md) - Installation and usage
- [14 - PHP SDK](./14-sdk-php.md) - Installation and usage
- [15 - n8n Integration](./15-n8n-integration.md) - Workflow automation

### Deployment
- [16 - Docker Deployment](./16-deployment-docker.md) - Production setup
- [17 - Development Guide](./17-development.md) - Contributing to MultiWA

### Operations
- [18 - Configuration Reference](./18-configuration-reference.md) - Environment variables
- [19 - Database Backup](./19-database-backup.md) - Backup & restore guide

---

## 🚀 Quick Links

- **GitHub**: [github.com/ribato22/MultiWA](https://github.com/ribato22/MultiWA)
- **Docker image (API)**: [hub.docker.com/r/ribato/multiwa-api](https://hub.docker.com/r/ribato/multiwa-api)
- **TypeScript SDK source**: [`packages/sdk`](../packages/sdk)
- **Python SDK source**: [`packages/sdk-python`](../packages/sdk-python)
- **PHP SDK source**: [`packages/sdk-php`](../packages/sdk-php)

> The TypeScript SDK is live on npm (`npm install @multiwa/sdk`), the Python SDK on PyPI (`pip install multiwa`), and the n8n community node on npm (`npm install n8n-nodes-multiwa`). The PHP SDK (`multiwa/sdk`) still ships as an in-repo package; its Packagist entry is tracked as a release follow-up — until then, install it from this repository or via the package's local path.

---

## 🆘 Support

- [Issue Tracker](https://github.com/ribato22/MultiWA/issues)
- [Discussions](https://github.com/ribato22/MultiWA/discussions)
- [Security Policy](../SECURITY.md)

---

Made with ❤️ by the MultiWA Community
