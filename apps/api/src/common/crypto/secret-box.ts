// MultiWA Gateway API - secrets at rest
// apps/api/src/common/crypto/secret-box.ts
//
// AES-256-GCM under ENCRYPTION_KEY, stored as `iv:authTag:ciphertext` in hex: the server settings' S3 and SMTP secrets
// and the customer lookup's secret. A value written here must always read back, so the format and the key derivation
// never change.

import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const logger = new Logger('SecretBox');

/**
 * The key from ENCRYPTION_KEY: 64 hex characters are the key's bytes, any other value goes through SHA-256. Unset, it is
 * an error in production and an ephemeral key elsewhere.
 */
export function getEncryptionKey(): Buffer {
  let key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      // Never made up in production: a fresh key each restart makes every secret encrypted before it unreadable.
      throw new Error(
        'ENCRYPTION_KEY is required in production. Set a stable 32-byte hex key (e.g. `openssl rand -hex 32`).',
      );
    }
    key = crypto.randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY = key;
    console.warn('[SecretBox] ENCRYPTION_KEY unset — generated an ephemeral dev key (set ENCRYPTION_KEY in .env for persistence; required in production).');
  }
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }
  return crypto.createHash('sha256').update(key).digest();
}

/** `text` encrypted with a fresh IV, as `iv:authTag:ciphertext` in hex. */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/** What `encrypt` wrote, or '' when it cannot be read (another key, a damaged value); the failure is logged. */
export function decrypt(encryptedText: string): string {
  try {
    const key = getEncryptionKey();
    const parts = encryptedText.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(parts[2], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    logger.error(`Decryption failed: ${(err as Error).message}`);
    return '';
  }
}
