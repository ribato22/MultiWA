# 11 - Groups API

Full WhatsApp group management capabilities.

---

## 11.1 Overview

MultiWA provides comprehensive group management including:

- List all groups
- Get group details with participants
- Create new groups
- Update group name/description
- Add/remove participants
- Promote/demote admins
- Get/revoke invite links

---

## 11.2 Endpoints

### List All Groups

```http
GET /api/groups/profile/:profileId
```

**Response:**
```json
[
  {
    "id": "628xxx-xxx@g.us",
    "name": "Family Group",
    "description": "Family chat",
    "owner": "628123456789@c.us",
    "createdAt": "2024-01-01T00:00:00Z",
    "participantsCount": 10
  }
]
```

---

### Get Group Info

```http
GET /api/groups/:groupId?profileId=xxx
```

**Response:**
```json
{
  "id": "628xxx-xxx@g.us",
  "name": "Family Group",
  "description": "Family chat",
  "owner": "628123456789@c.us",
  "createdAt": "2024-01-01T00:00:00Z",
  "participantsCount": 10,
  "participants": [
    {
      "id": "628123456789@c.us",
      "phone": "628123456789",
      "pushName": "John",
      "isAdmin": true,
      "isSuperAdmin": true
    }
  ]
}
```

---

### Create Group

```http
POST /api/groups
```

**Request:**
```json
{
  "profileId": "profile-123",
  "name": "New Group",
  "participants": ["628123456789", "628987654321"],
  "description": "Optional description"
}
```

---

### Add Participants

```http
POST /api/groups/:groupId/participants/add
```

**Request:**
```json
{
  "profileId": "profile-123",
  "participants": ["628111111111", "628222222222"]
}
```

---

### Remove Participants

```http
POST /api/groups/:groupId/participants/remove
```

**Request:**
```json
{
  "profileId": "profile-123",
  "participants": ["628111111111"]
}
```

---

### Promote to Admin

```http
POST /api/groups/:groupId/participants/promote
```

**Request:**
```json
{
  "profileId": "profile-123",
  "participants": ["628111111111"]
}
```

---

### Demote from Admin

```http
POST /api/groups/:groupId/participants/demote
```

---

### Get Invite Link

```http
GET /api/groups/:groupId/invite-link?profileId=xxx
```

**Response:**
```json
{
  "link": "https://chat.whatsapp.com/ABC123XYZ"
}
```

---

### Revoke Invite Link

```http
POST /api/groups/:groupId/invite-link/revoke?profileId=xxx
```

Returns new invite link after revoking the old one.

---

## 11.3 Python SDK Example

```python
from multiwa import MultiWA

client = MultiWA("http://localhost:3001/api", "YOUR_API_KEY")

# List all groups
groups = client.groups.get_all("profile-123")

# Create a group
new_group = client.groups.create(
    profile_id="profile-123",
    name="Project Team",
    participants=["628123456789", "628987654321"]
)

# Add participant
client.groups.add_participants(
    profile_id="profile-123",
    group_id="628xxx@g.us",
    participants=["628111111111"]
)
```

---

[← Messaging](./10-messaging.md) · [Documentation Index](./README.md) · [Automation →](./12-automation.md)
