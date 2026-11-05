---
sidebar_position: 5
title: "Customers"
---

# Customers

A WhatsApp number tells an agent little about who is writing. The customer profile adds:

- **the customer's ID** in your own system (for example a customer or account number), linked to the number;
- **live master data** (name, address, contract, open bills …) that MultiWA fetches from an endpoint you provide, when the profile opens;
- **notes and tags** the team keeps about the customer;
- **the history**: the conversations and calls of every number linked to the customer.

It appears in the **Contact Info** of a one-to-one chat and under a one-to-one call on the **Calls** page (the call's **Customer** button). The **Customers** page, in the sidebar for every role, lists every customer and opens each one with its numbers and history. A group, or a contact whose number WhatsApp hides (an `@lid` id), has no profile.

## Numbers and IDs

A number can be linked to several IDs (one person with a home and a shop), and an ID to several numbers (a family). In the chat the agent picks the ID the conversation is about; the one picked last is that number's default next time.

The ID can be letters, digits, `.`, `_` and `-`, up to 64 characters. A number is stored as digits only, 8 to 15 of them. A leading `0` is read as Indonesia's `62` (`0812…` becomes `62812…`); give a number of any other country with its country code.

## Who may do what

| | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| See profiles, lookups, notes, history; search customers | ✓ | ✓ | ✓ | ✓ |
| Link and unlink numbers, pick the default ID, check an ID before linking it, write notes, edit tags | ✓ | ✓ | ✓ | |
| Edit or delete someone else's note | ✓ | ✓ | | |
| Delete a customer; set up the lookup (Settings → Customers) | ✓ | ✓ | | |

An API key acts with its user's role. A key with a scope list needs `customers:read` to read and `customers:write` to change anything.

## Linking from another system

A bot that already knows a customer's ID can link it, for example after the customer typed it in WhatsApp:

```bash
curl -X POST https://your-multiwa/api/v1/customers/links \
  -H "x-api-key: $MULTIWA_API_KEY" -H "Content-Type: application/json" \
  -d '{"externalId": "1234567890", "phone": "6281100000001"}'
```

The answer is `201` with the new link, or `200` when the number was already linked to that ID; in that case too, that ID becomes the number's default. Each link records who made it: the agent, or the API key.

`phone` is a number, or the JID of a one-to-one chat such as `6281100000001@s.whatsapp.net`; a device's JID (`6281100000001:12@s.whatsapp.net`) links the number. A group (`@g.us`), an `@lid` or `@broadcast` JID, or a number outside 8 to 15 digits answers `400` "Invalid phone number". An ID that breaks the rule above answers `400` "Invalid customer ID".

## The lookup endpoint

Set it up in **Settings → Customers**:

- **ID label**: what the ID is called in your organization ("Customer ID" by default), shown wherever the ID appears;
- **Lookup URL**: your endpoint;
- **Secret**: sent as `Authorization: Bearer <secret>`. It is stored encrypted and never shown again, and no API answer carries it (`GET /customers/config` only says whether one is set); replace or clear it;
- **Timeout (ms)**: 1000 to 15000 (1 to 15 seconds), 5000 by default.

**Test** looks up one ID with the saved settings, skipping the cache, and shows whether it was found (with the name) and how long it took.

Without a lookup URL, agents type the customer's name and a few fields by hand.

### The contract

MultiWA asks:

```
GET <lookup URL>?id=<the customer's ID>
Authorization: Bearer <secret>
Accept: application/json
```

Your endpoint answers `200` with:

```json
{
  "id": "1234567890",
  "name": "Budi Santoso",
  "fields": [
    { "label": "Address", "value": "Jl. Contoh 1" },
    { "label": "Plan", "value": "R1 / 1300 VA" }
  ],
  "sections": [
    { "title": "Bills", "rows": [ { "label": "Oct 2026", "value": "245,000 (paid)" } ] }
  ]
}
```

- every key is optional; unknown keys are ignored;
- `id` up to 64 characters; `name` up to 200 characters; up to 50 `fields`; up to 10 `sections` of up to 50 `rows`; a label or title up to 60 characters and a value up to 500;
- the whole answer up to 64 KB.

| Your endpoint | The panel shows |
|---|---|
| `200` in this format | the data |
| `404` | "Not found: the lookup has no customer with this ID", with Refresh |
| anything else, a redirect, a timeout, too large, not this format | "The lookup is unavailable right now", with Retry |

Values are shown as plain text. MultiWA keeps an answer for 60 seconds (**Refresh** asks again) and stores only the `name`, so the Customers page can list and search names. Everything else stays in your system.

The lookup URL follows the webhooks' rule: a private or local address is refused unless the server sets `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` ([Configuration](<../operations/configuration-reference.md>)).

### An example endpoint

```js
// node lookup.js  — answers MultiWA's lookups from a small in-memory table
const http = require('http');
const SECRET = process.env.LOOKUP_SECRET;
const customers = new Map([
  ['1234567890', { name: 'Budi Santoso', fields: [{ label: 'Address', value: 'Jl. Contoh 1' }] }],
]);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (SECRET && req.headers.authorization !== `Bearer ${SECRET}`) { res.writeHead(401).end(); return; }
  const id = url.searchParams.get('id');
  const customer = customers.get(id);
  if (!customer) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id, ...customer }));
}).listen(8099);
```

## The API

All routes are in the [API specification](<../api/api-specification.md#customers-customers>). The ones a bot or an integration uses most:

| Route | What |
|---|---|
| `POST /customers/links` | link a number to an ID (creates the customer when new) |
| `GET /customers/by-phone/:phone` | the IDs linked to a number, the default first |
| `GET /customers/:id/lookup` | the live master data |
| `GET /customers/lookup?externalId=` | what the lookup says of an ID that is not linked yet, for an agent to check it before linking; stores nothing. At most 30 a minute for each user, or for each API key; past that `429` |
| `POST /customers/:id/notes` | add a note |
| `GET /customers?q=` | search by ID (prefix), number or name; a `%` or `_` in `q` matches itself |

## Privacy

The organization's data export (`GET /account/export`, owners and admins) includes its customers, their links, notes and tags. Deleting a customer deletes its links and notes. The audit log records linking and unlinking, changes to and deletion of a customer, notes, and changes to the lookup settings, with ids only.
