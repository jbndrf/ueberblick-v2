# Security policy

## Reporting a vulnerability

Do not open a public issue. Report privately through one of these channels:

- GitHub private vulnerability reporting (Security tab, "Report a vulnerability") on the repository.
- Email: `security@example.org` (needs-owner: placeholder, replace before release).

Please include the affected version, steps to reproduce and the impact you expect. Encrypted mail is welcome once a
PGP key is published (needs-owner: key and fingerprint). Reports in German or English are fine.

The machine-readable version of this page is `ops/security.txt` (RFC 9116).

## Response times

| Step | Target |
|---|---|
| Acknowledge receipt | 3 working days |
| First assessment (accepted, needs info, or declined) | 10 working days |
| Fix or mitigation for critical and high severity | 30 days |
| Fix for medium and low severity | next regular release |

We ask reporters to keep the details private until a fix is released or 90 days have passed, whichever comes first.

## GHSA and CVE process

1. The maintainers open a draft GitHub Security Advisory (GHSA) for the confirmed report and add the reporter as a
   collaborator on it.
2. Severity is scored with CVSS 3.1 or 4.0 and the affected and patched versions are set.
3. A CVE identifier is requested through the GHSA (GitHub is the CNA) before the fix is published.
4. The fix is prepared in the private advisory fork, released, and the advisory is published together with the release.
5. The reporter is credited unless they ask not to be.

## Supported versions

Only the latest release receives security fixes until a support policy is set (needs-owner).

## Supply chain

Each release ships a CycloneDX SBOM (`npm run sbom`). See `docs/process/release.md`.
