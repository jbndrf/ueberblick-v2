# Signing in

## E-mail and password
Admins sign in at `/admin/login` with e-mail and password (password at least 10 characters). The first admin comes from `.env` (see `server-install.en.md`).

- **Errors at the field.** An invalid e-mail address or a password under 6 characters is marked red and explained under the field; nothing is sent until both are valid.
- **Several tabs.** Signing out in one tab sends all other tabs of the same browser back to the sign-in page.
- **The one-time code (TOTP) is optional.** The default is `ADMIN_TOTP=off`: e-mail and password only, the *One-time code* field is hidden. With `ADMIN_TOTP=on` sign-in also asks for the 6-digit code of an authenticator app.
- **Enrolment with `ADMIN_TOTP=on`:** someone who has not set up a code leaves the field empty and signs in. After the right password a QR code (and the key to type by hand) for the authenticator app appears once. Sign in again with the first code from the app; that confirms the code. A second attempt without a code creates a new key and the old one stops working.
- **Stay signed in for 30 days:** without the tick the session ends after 12 hours, with it after `SESSION_DAYS_ADMIN_REMEMBER` days (default 30).
- After 5 failed attempts in 15 minutes sign-in pauses briefly (see `server-install.en.md`).

# Sign in with an OpenID Connect provider

Besides e-mail and password (optionally with a one-time code), admins can sign in with an external identity provider (Keycloak, Azure AD, a municipal IdP). The login screen shows a *Sign in with <provider>* button per configured provider (the screen itself comes in a later phase).

## Configure a provider (operator)
Per provider you set:
- **key**: short name, used in the callback address.
- **issuer**: the provider's issuer URL. It must match the `iss` of every ID token; the endpoints are found via `<issuer>/.well-known/openid-configuration`.
- **client id** and **redirect address** (register the same address at the provider).
- **client secret**: not in the config file. Give the *name of an environment variable* (`clientSecretEnv`) that holds it on the server.
- optional: scopes (default `email`; `openid` is always sent) and the allowed signature algorithms (RS256, ES256).

The flow is authorization code with PKCE (S256), state and nonce. The provider's signing keys are fetched automatically and cached for 10 minutes; a key change at the provider is picked up.

## Link an admin
Nobody is signed in just because the provider knows them. An operator links the provider's subject (`sub`) to an existing admin account. After that, that person signs in with the button and gets a normal admin session (12 hours, revocable, ended by logout). The provider is responsible for its own multi-factor step, so no TOTP is asked.

## Create admins automatically (optional, off by default)
If you set a **provisioning rule** (a claim and the value it must contain, for example `groups` = `ueb-admins`), an unknown person whose ID token matches gets an account on first sign-in. Without the rule, unknown people are refused. An existing account is never linked by email address alone. Accounts created this way have no password.

## When sign-in is refused
Expired or reused sign-in attempts (older than 10 minutes), an invalid ID token, or a person who is not linked all end in a refusal. Start the sign-in again; if it repeats, check issuer, client id, redirect address and the secret variable.
