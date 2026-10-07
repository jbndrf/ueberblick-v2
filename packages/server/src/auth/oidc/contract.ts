/**
 * CONTRACT of OIDC login (WP-532): authorization code flow + PKCE (S256), state and nonce.
 * Generic over provider and principal: nothing here is admin-only except the account lookup in the service.
 * The result is the ordinary `Session` (hashed, revocable), so logout is `Auth.revokeSession`.
 * HTTP routing stays out (WP-113 mounts `beginLogin` and `completeLogin`).
 */
import type { Session } from '../contract';
import type { OidcAlgorithm, OidcErrorCode } from './registry';

export interface OidcError {
  readonly code: OidcErrorCode;
}

export function isOidcError(x: object): x is OidcError {
  return 'code' in x && !('id' in x);
}

/** Provisioning rule: an account is created on first login only when the ID-token claim equals `value`. */
export interface OidcProvisionRule {
  readonly claim: string;
  readonly value: string;
}

/** Operator configuration of one provider. Holds no secret: `clientSecretEnv` names an environment variable. */
export interface OidcProvider {
  /** Stable key, part of the callback route. */
  readonly key: string;
  /** Must equal the `iss` of every ID token; discovery lives at `<issuer>/.well-known/openid-configuration`. */
  readonly issuer: string;
  readonly clientId: string;
  /** Name of the environment variable holding the client secret. Omit for a public client. */
  readonly clientSecretEnv?: string;
  readonly redirectUri: string;
  /** Default `['email']`. `openid` is always sent. */
  readonly scopes?: readonly string[];
  /** Default: all of `OIDC_ALGORITHMS`. */
  readonly algorithms?: readonly OidcAlgorithm[];
  /** Claim mapped to the account email when provisioning. Default `email`. */
  readonly emailClaim?: string;
  /** Absent = no auto-provisioning: unlinked subjects are refused. */
  readonly provision?: OidcProvisionRule;
}

export interface LoginStart {
  /** Redirect the browser here. */
  readonly redirectUrl: string;
  readonly state: string;
}

export interface CallbackParams {
  readonly state?: string;
  readonly code?: string;
  readonly error?: string;
}

/** Server-side record of a started login. Consumed exactly once. */
export interface PendingLogin {
  readonly providerKey: string;
  readonly nonce: string;
  readonly verifier: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

/** Port: where started logins wait for their callback. Default is in memory; a shared store can replace it. */
export interface OidcStateStore {
  /** False when the store is full (after sweeping expired entries): the login must be refused. */
  put(state: string, pending: PendingLogin): boolean;
  /** Returns and deletes (single use); null when unknown. */
  take(state: string): PendingLogin | null;
}

export interface Oidc {
  beginLogin(providerKey: string): Promise<LoginStart | OidcError>;
  completeLogin(params: CallbackParams, device?: string): Promise<Session | OidcError>;
  /** Operator action: links a provider subject to an existing account (stored in `accounts.oidc_sub`). Throws for an unknown account or provider. */
  linkSubject(accountId: string, providerKey: string, subject: string): void;
}
