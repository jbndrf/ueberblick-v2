/** Every tunable of the OIDC module lives here. */
export const OIDC_PARAMS = {
  /** A login must be completed within this time after `beginLogin`. */
  stateTtlMs: 10 * 60_000,
  /** JWKS and discovery documents are cached this long. */
  jwksTtlMs: 10 * 60_000,
  /** An unknown `kid` forces one refetch (key rotation), at most this often. */
  jwksMinRefetchMs: 30_000,
  /** Tolerated clock difference for exp/iat. */
  clockSkewSeconds: 60,
  /** Started logins waiting for their callback; further `beginLogin` calls are refused (bounds memory against unauthenticated floods). */
  maxPending: 1000,
  verifierBytes: 32,
  stateBytes: 24,
  nonceBytes: 24,
} as const;
