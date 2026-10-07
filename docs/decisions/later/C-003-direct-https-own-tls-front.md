# C-003 Direct HTTPS mode uses the app's own TLS front, not a Caddy container
priority: medium        status: provisional
date: 2026-10-01   lead: c   work packages: WP-941   touches: H6 (external GIS clients over HTTPS), R13, deploy

## Context
The owner chose two HTTPS modes (`docs/research/v3-parity/step-1-plan.md`): `proxy` (behind the operator's reverse proxy) and `direct` (local self-signed HTTPS on IP:port, no domain, no Let's Encrypt). The step-1 plan sketched `direct` as a Caddy compose profile. WP-941 built it differently.

## Options
- A) Caddy container under `--profile direct`, with its internal CA. Consequence: Caddy owns the CA, so the SAN list (`LOCAL_HOSTS`), the reissue rule and the CA offered on `/setup/zertifikat` live in two places (R1). Requests arrive from a second container whose IP is not known up front, which conflicts with "forwarded headers only from `TRUSTED_PROXIES`".
- B) The app's own TLS front (`scripts/tls/front.mjs`), started by the entrypoint when `HTTPS_MODE=direct`. It has a local CA valid for about 10 years, and the server certificate's SANs equal `LOCAL_HOSTS`. A host change reissues only the server certificate. Certificates are built with hand-written DER via `node:crypto`, with no new dependency, and `openssl verify` accepts them. The app sees the front as loopback.

## Chosen (provisional)
B, because there is one place for the CA, the SANs and the setup page, and no unknown proxy hop. The seam: `loadTlsMaterial` accepts own certificate files (`TLS_CERT_FILE`, `TLS_KEY_FILE`) without changing callers. A proxy in front still works through `proxy` mode.

## Cost to change later
now: small · after the build: one compose service plus deleting `scripts/tls/front.mjs`. The CA would change, so phones would need to install the new CA once.
