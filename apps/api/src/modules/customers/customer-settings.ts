// MultiWA Gateway API - the customer lookup's settings inside an organization row
// apps/api/src/modules/customers/customer-settings.ts

/**
 * An organization as the API answers it: without its customer lookup's encrypted secret. Every answer that carries an
 * organization row passes it through here; GET /customers/config says whether a secret is set.
 */
export function withoutLookupSecret<T extends { settings: unknown }>(org: T): T {
  const customers = (org.settings as Record<string, any> | null)?.customers;
  if (!customers || typeof customers !== 'object' || !('lookupSecretEnc' in customers)) return org;
  const { lookupSecretEnc: _secret, ...rest } = customers;
  return { ...org, settings: { ...(org.settings as object), customers: rest } };
}
