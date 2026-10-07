import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Why an instance-level gate refused a request (WP-638). */
export const INSTANCE_ERRORS = defineRegistry([
  {
    key: 'consent_required',
    status: 403,
    description: 'The operator requires consent and the visitor has not accepted it (no consent cookie).',
  },
] as const);
export type InstanceErrorCode = KeyOf<typeof INSTANCE_ERRORS>;

/** What a visitor can decide in the consent modal. */
export const CONSENT_DECISIONS = defineRegistry([
  { key: 'accepted', description: 'The visitor accepted; sign-in and join are open to them.' },
  { key: 'rejected', description: 'The visitor rejected; the gate stays closed.' },
] as const);
export type ConsentDecision = KeyOf<typeof CONSENT_DECISIONS>;
