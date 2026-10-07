import { defineRegistry, type KeyOf } from '@ueberblick/core';

/** Why an authentication attempt was refused. Deliberately coarse: no account enumeration. */
export const AUTH_ERRORS = defineRegistry([
  { key: 'credential_unknown', description: 'The participant token does not match any credential.' },
  { key: 'credential_revoked', description: 'The credential was revoked by an admin.' },
  { key: 'credential_expired', description: 'The credential is past its expiry.' },
  {
    key: 'participant_disabled',
    description: 'The participant is disabled; the token works again once they are enabled.',
  },
  { key: 'token_duplicate', description: 'The chosen token is already in use in this instance.' },
  { key: 'token_too_short', description: 'The chosen token is shorter than the minimum length.' },
  {
    key: 'token_invalid',
    description: 'The chosen token has characters outside the allowed set or is too long.',
  },
  { key: 'invalid_login', description: 'Unknown account, wrong password or wrong TOTP code.' },
  { key: 'mfa_not_enrolled', description: 'The admin account has no confirmed TOTP; enrol first.' },
] as const);
export type AuthErrorCode = KeyOf<typeof AUTH_ERRORS>;

/**
 * What an API token (QGIS / GIS access, WP-388, A-037) may do. Today one scope: everything the participant may do (Q18).
 * A narrower scope (an assistant that only reads, H4) is one more entry plus a check where the scope is read.
 */
export const API_TOKEN_SCOPES = defineRegistry([
  { key: 'full', description: 'Everything the participant may do, as the participant (Q18).' },
] as const);
export type ApiTokenScope = KeyOf<typeof API_TOKEN_SCOPES>;
