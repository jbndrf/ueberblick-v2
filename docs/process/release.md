# Release artefacts

Where each supply-chain artefact comes from, and what the owner must fill in. Standards: `docs/09-standards.md`.

| Artefact | Source | Produced by | Checked by |
|---|---|---|---|
| SBOM `dist/sbom.cdx.json` (CycloneDX 1.5, workspaces included, dev dependencies excluded) | `npm ls` on the lockfile tree | `npm run sbom` (`scripts/sbom.mjs`) per release | `scripts/sbom.spec.mjs` validates against the official CycloneDX JSON schema |
| `SECURITY.md` | hand-written | maintainers | reviewed at release |
| `ops/security.txt` (RFC 9116) | hand-written | maintainers; Phase 2 serves it at `/.well-known/security.txt` | `scripts/sbom.spec.mjs` fails when `Expires` is less than 30 days away |
| `publiccode.yml` | hand-written | maintainers | `scripts/sbom.spec.mjs` validates against the publiccode.yml schema (`scripts/schemas/publiccode.schema.json`, from SchemaStore) |

## Release steps

1. `npm run check` is green.
2. `npm run sbom`; attach `dist/sbom.cdx.json` to the release.
3. Bump `Expires` in `ops/security.txt` (keep it at least 30 days ahead; at most one year is advised by RFC 9116).
4. Bump `softwareVersion` (and `releaseDate`) in `publiccode.yml`.

## What the owner must fill in (needs-owner)

- `ops/security.txt`: real `Contact` and `Policy` URL (both are `example.org` placeholders).
- `SECURITY.md`: report email, PGP key, support policy.
- `publiccode.yml`: repository `url`, maintenance contact (name and email), organisation, and the licence. The licence
  (`AGPL-3.0-only`, full text in `LICENSE`) was decided by the owner on 2026-10-04 (O7).
