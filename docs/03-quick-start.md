# 03 - Quick Start

Get MultiWA running in under 5 minutes.

---

## Prerequisites

- Docker & Docker Compose installed (recommended)
- OR Node.js 24+, pnpm 9+, PostgreSQL 16+, and Redis 7+ for local development

---

## Option A: Docker (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA

# 2. Copy the Docker environment template
cp .env.docker .env

# 3. Start the stack
docker compose up -d

# 4. Watch logs until the API is ready (Ctrl+C to detach)
docker compose logs -f api
```

Once the API logs print `MultiWA Gateway API running on http://0.0.0.0:3333`, the stack is ready.

| Service | URL |
|---------|-----|
| Admin Dashboard | http://localhost:3001 |
| API base | http://localhost:3333/api/v1 |
| Swagger UI | http://localhost:3333/api/docs |

> The full stack profile (S3-compatible storage + Nginx) is `docker compose --profile full up -d`.

---

## Option B: Local Development

```bash
# 1. Clone the repository
git clone https://github.com/ribato22/MultiWA.git
cd MultiWA

# 2. Install workspace dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
# Edit .env: at minimum set DATABASE_URL, REDIS_URL, and JWT_SECRET

# 4. Generate the Prisma client and sync the schema (no migrations dir → db push)
pnpm --filter database exec prisma generate
pnpm --filter database exec prisma db push

# 5. Build workspace packages used by the API
pnpm --filter database build
pnpm --filter engines build

# 6. Start the dev servers in two terminals
pnpm --filter api dev     # API on http://localhost:3000  (local dev default)
pnpm --filter admin dev   # Admin on http://localhost:3001
```

> Note: in local-dev mode the API defaults to port `3000`. The Docker stack uses port `3333` because that is what `docker-compose.yml` sets via `API_PORT`. The Swagger UI is always at `<API base host>:<API port>/api/docs`.

---

## First Steps

Replace `http://localhost:3333` with your API base if you are not using the default Docker port. The global API prefix is always `/api/v1`.

### 1. Register an account

The first account becomes the server's owner, and until it exists anyone who reaches the server can claim it: create it before you expose the server.

```bash
curl -X POST http://localhost:3333/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "ChangeMe1234!",
    "name": "Admin",
    "organizationName": "My Company"
  }'
```

The response includes an `accessToken`. Use it as `Authorization: Bearer ...` for the next calls.

> **Prefer the dashboard?** Sign in at http://localhost:3001 with the same email and password, open **Profiles → Add Profile**, and scan the QR it shows. That covers steps 2 to 4; carry on with step 5.

### 2. Find your workspace

Registering also created a workspace named `Default`, and every profile belongs to one. List your workspaces and copy the `id` of `Default`:

```bash
curl http://localhost:3333/api/v1/workspaces \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. Create a Profile

A profile is one WhatsApp number. Use the workspace `id` from step 2:

```bash
curl -X POST http://localhost:3333/api/v1/profiles \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"workspaceId": "YOUR_WORKSPACE_ID", "name": "My WhatsApp"}'
```

Copy the `id` from the answer: it is `YOUR_PROFILE_ID` below.

### 4. Link your number

WhatsApp links a number when you scan a QR code with the phone. No REST call returns that QR: the server sends it over the WebSocket as the `qr:update` event, to owners and admins only (see [WebSocket API](./08-websocket-api.md)).

**In the dashboard:** sign in at http://localhost:3001 with the account from step 1, open **Profiles**, choose the profile and press **Connect WhatsApp**. The QR appears on the profile's page and refreshes by itself.

**Over the API:** open a Socket.IO connection, join the profile, and only then start the connection: a QR is sent only to the sockets that have joined the profile. Save this as `link.mjs` (it needs Node.js 18 or newer and `npm install socket.io-client`):

```js
import { io } from 'socket.io-client';
import { writeFileSync } from 'node:fs';

const API = 'http://localhost:3333';
const { TOKEN, PROFILE_ID } = process.env;

const socket = io(`${API}/ws`, { auth: { token: TOKEN } });

socket.on('connect', () => {
  socket.emit('join', { profileId: PROFILE_ID }, async (res) => {
    if (!res?.success) {
      console.error('join refused:', res?.error);
      process.exit(1);
    }
    const connect = await fetch(`${API}/api/v1/profiles/${PROFILE_ID}/connect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    console.log('connect:', connect.status, await connect.text());
  });
});

// A PNG data URL; a new code replaces it every 20 seconds or so until it is scanned.
socket.on('qr:update', ({ qrCode }) => {
  writeFileSync('qr.png', Buffer.from(qrCode.split(',')[1], 'base64'));
  console.log('Scan qr.png with WhatsApp');
});

socket.on('connection:status', ({ status, phoneNumber }) => {
  console.log('status:', status, phoneNumber ?? '');
  if (status === 'connected') process.exit(0);
});

socket.on('disconnect', (reason) => console.log('disconnected:', reason));
```

```bash
TOKEN=YOUR_TOKEN PROFILE_ID=YOUR_PROFILE_ID node link.mjs
```

Open `qr.png`, then on your phone open WhatsApp → **Linked devices** → **Link a device** → scan the QR. The file is rewritten with each new code, so reopen it if a scan fails. The script exits once the profile is `connected`.

### 5. Send a Text Message

```bash
curl -X POST http://localhost:3333/api/v1/messages/text \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "profileId": "YOUR_PROFILE_ID",
    "to": "628123456789",
    "text": "Hello from MultiWA!"
  }'
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `docker compose up -d` exits, no containers | Ports `3001` / `3333` / `5433` / `6380` already in use | Stop the conflicting service or override the ports in `.env` (`ADMIN_PORT`, `API_PORT`, `DB_PORT`, `REDIS_PORT`) |
| Swagger at `/api/docs` returns 404 | API still booting | Wait for the `MultiWA Gateway API running` log line, then retry |
| `401 Unauthorized` | Missing or expired token | Log in again with `POST /api/v1/auth/login` (`{"email": "...", "password": "..."}`) for a fresh `accessToken`, and send it as `Authorization: Bearer ...` |
| `link.mjs` prints `disconnected: io server disconnect` | The token is missing, wrong or expired | Log in again, then run it with the new `TOKEN` |
| `link.mjs` prints `join refused: Forbidden` | `PROFILE_ID` is not a profile of your organization | Copy the `id` from the answer of step 3 again |
| `link.mjs` prints `connect:` but no QR follows | The profile is already linked (`connect:` shows `already_connected`), or the engine is still starting: the first start can take up to 30 seconds | Read `GET /api/v1/profiles/YOUR_PROFILE_ID/status`: `connected` needs nothing more, `connecting` means the engine is still starting |

---

## Next Steps

- [API Specification](./07-api-specification.md) — full endpoint reference
- [Webhook Events](./09-webhook-events.md) — receive real-time events
- [Python SDK](./13-sdk-python.md) — integrate from Python
- [Docker Deployment](./16-deployment-docker.md) — production setup

---

[← Requirements](./02-requirements.md) · [Documentation Index](./README.md) · [System Architecture →](./04-system-architecture.md)
