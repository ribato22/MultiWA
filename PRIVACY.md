# Privacy Policy Template

> **Note**: This is a template for self-hosted MultiWA instances. Customize it for your organization, jurisdiction, and use case. This template provides GDPR-compliant language but should be reviewed by legal counsel.

---

## Privacy Policy for [Your Organization Name]

**Last Updated:** [DATE]

### 1. Introduction

[Your Organization Name] ("we", "our", "us") operates the MultiWA WhatsApp Gateway platform at [YOUR_DOMAIN]. This privacy policy explains how we collect, use, store, and protect your personal data in compliance with the General Data Protection Regulation (GDPR), Indonesia's Personal Data Protection Law (UU PDP No. 27/2022), and other applicable privacy laws.

### 2. Data Controller

**Data Controller:** [Your Organization Name]  
**Contact Email:** [privacy@yourdomain.com]  
**Address:** [Your Address]

### 3. Data We Collect

| Category | Data | Purpose | Legal Basis |
|----------|------|---------|-------------|
| **Account** | Name, email, hashed password | Authentication & authorization | Contract performance |
| **Messages** | WhatsApp messages sent/received | Core service functionality | Contract performance |
| **Contacts** | Phone numbers, names, tags | Contact management | Legitimate interest |
| **Analytics** | Message counts, delivery stats | Service improvement | Legitimate interest |
| **Security** | IP addresses, login timestamps, audit logs | Security & fraud prevention | Legitimate interest |
| **Push Subscriptions** | Browser push endpoints | Notification delivery | Consent |

### 4. Data Processing

- **All data is processed on your self-hosted infrastructure.** MultiWA does not transmit any data to external servers unless you configure third-party integrations (n8n, Typebot, Chatwoot).
- **WhatsApp messages** are routed through WhatsApp's servers per their terms of service.
- **Passwords** are stored as bcrypt hashes (never in plaintext).
- **Sensitive settings** (API keys, SMTP credentials) are encrypted at rest using AES-256-GCM.

### 5. Data Retention

| Data Type | Retention Period | Notes |
|-----------|------------------|-------|
| Messages | [30/90/365 days] | Configurable per profile |
| Audit logs | [90 days] | Security requirement |
| Contacts | Until deleted | User-managed |
| Account data | Until account deletion | GDPR Art. 17 applies |

### 6. Your Rights (GDPR Articles 15–22)

You have the following rights regarding your personal data:

| Right | Description | How to Exercise |
|-------|-------------|-----------------|
| **Access** (Art. 15) | Export all your data | `GET /api/v1/account/export` |
| **Erasure** (Art. 17) | Delete your account and all data | `DELETE /api/v1/account/delete` |
| **Rectification** (Art. 16) | Correct inaccurate data | Edit via Admin Dashboard |
| **Portability** (Art. 20) | Download data in machine-readable format | JSON export via API |
| **Object** (Art. 21) | Object to data processing | Contact DPO |
| **Restrict** (Art. 18) | Restrict processing of your data | Contact DPO |

### 7. Data Security

We implement the following security measures:

- ✅ **Encryption in transit** — TLS/HTTPS for all connections
- ✅ **Encryption at rest** — AES-256-GCM for sensitive settings
- ✅ **Authentication** — JWT tokens + optional 2FA (TOTP)
- ✅ **Authorization** — Role-Based Access Control (RBAC)
- ✅ **Audit logging** — All security-relevant actions logged
- ✅ **Rate limiting** — Protection against brute-force attacks
- ✅ **Security headers** — Helmet.js, HSTS, X-Frame-Options, CSP

### 8. Third-Party Integrations

If you configure third-party integrations, data may be shared with:

| Integration | Data Shared | Purpose |
|-------------|-------------|---------|
| n8n | Webhook events | Workflow automation |
| Typebot | Message content | Chatbot conversations |
| Chatwoot | Messages + contacts | Customer support |
| MinIO/S3 | Media files | File storage |

### 9. Cookies

MultiWA uses only **essential cookies** for authentication (JWT session tokens). We do not use tracking cookies, analytics cookies, or advertising cookies.

### 10. Data Breach Notification

In the event of a personal data breach, we will:
- Notify the supervisory authority within **72 hours** (GDPR Art. 33)
- Notify affected users without undue delay (GDPR Art. 34)

### 11. Children's Privacy

MultiWA is not intended for use by individuals under the age of 16. We do not knowingly collect personal data from children.

### 12. Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted at [YOUR_DOMAIN/privacy] with the updated date.

### 13. Contact

For privacy-related inquiries or to exercise your rights:

**Data Protection Officer:** [Name]  
**Email:** [privacy@yourdomain.com]  
**Address:** [Your Address]

---

*This policy template is provided as guidance for self-hosted MultiWA instances. It does not constitute legal advice. Please consult with legal counsel to ensure compliance with your specific jurisdiction's privacy laws.*
