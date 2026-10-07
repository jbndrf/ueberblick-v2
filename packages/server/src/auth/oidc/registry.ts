import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Why an OIDC login was refused. Coarse on purpose: the caller shows one message, the audit log keeps the code. */
export const OIDC_ERRORS = defineRegistry([
  { key: 'state_unknown', description: 'The state is unknown, expired or was already used (replay).' },
  {
    key: 'provider_error',
    description: 'The provider answered the callback with an error, or its endpoints are unusable.',
  },
  {
    key: 'token_exchange_failed',
    description: 'The token endpoint refused the code or returned no ID token.',
  },
  {
    key: 'id_token_invalid',
    description: 'Signature, algorithm, iss, aud, exp, iat or nonce of the ID token failed validation.',
  },
  {
    key: 'subject_not_linked',
    description:
      'The subject is not linked to an admin principal and provisioning is off or its claim rule fails.',
  },
  {
    key: 'too_many_pending',
    description: 'Too many logins are waiting for their callback; try again shortly.',
  },
  { key: 'provider_unknown', description: 'No provider is configured under this key.' },
] as const);
export type OidcErrorCode = KeyOf<typeof OIDC_ERRORS>;

/** JWS algorithms an ID token may use. `none` and HS* are deliberately absent. */
export const OIDC_ALGORITHMS = defineRegistry([
  { key: 'RS256', description: 'RSASSA-PKCS1-v1_5 with SHA-256 (kty RSA).' },
  { key: 'ES256', description: 'ECDSA P-256 with SHA-256 (kty EC).' },
] as const);
export type OidcAlgorithm = KeyOf<typeof OIDC_ALGORITHMS>;
