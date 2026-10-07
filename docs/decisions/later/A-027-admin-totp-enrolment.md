# A-027 First-time admin TOTP enrolment stays an operator (CLI) step
priority: medium        status: provisional
date: 2026-09-30   lead: a   work packages: WP-180   touches: O10 (admin identity) / H4 role apps / docs/user/admin sign-in

## Context
WP-180 built the admin sign-in page (`/builder/login`: e-mail, password and TOTP in one form). `loginAdmin` refuses with `mfa_not_enrolled` until a TOTP is confirmed. The `api/auth/totp/enrol|confirm` routes need a signed-in admin, and no session exists before the first confirmed code. So a new admin can't finish enrolment in the browser; the operator's admin CLI (`bootstrap`, then `confirm-totp`) does it.

## Options
- A) Keep enrolment as an operator step (CLI), with the sign-in page naming that step when it gets `mfa_not_enrolled`. No server change.
- B) A short-lived, password-verified "enrolment-only" session that may call only `totp/enrol` and `totp/confirm`, plus a browser enrolment screen with a QR code (`qrSvg`, A-026). It needs a new session kind in auth, with its own expiry and limits, and a security review.
- C) One-time enrolment links issued by the CLI. It's a variant of B, still with a new token kind.

## Chosen (provisional)
A. The seam is the `mfa_not_enrolled` code and the sign-in page's dedicated message: B plugs in there without changing the login form. Revisit with O10 (OIDC in Phase 7). With OIDC, the identity provider may own MFA and make this moot.

## Cost to change later
now: nothing · later: B is one auth WP (session kind, two routes allowed, a screen) plus a security review
