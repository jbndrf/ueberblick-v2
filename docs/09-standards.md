# 09 · External standards

We adopt a standard where one exists, rather than inventing our own. Background and sources are in `research/std-0*.md` and `research/artifacts/02-standards-review.html`.

## Adopt (design them in)
| Area | Standard | How we use it |
|---|---|---|
| Feature data | **GeoJSON RFC 7946** | Storage and exchange are WGS84 with lon/lat order and about 7 decimal places. Winding is normalised on import. |
| CRS | **EPSG** codes, proj4 | Every import declares `source_crs`, detected by coordinate magnitude (UTM ≈ 500000/5300000) and confirmed by the user. EPSG:25832 and 25833 are the German defaults. |
| Geometry semantics | **OGC Simple Features / DE-9IM** | Function names and boundary behaviour. Predicates come from JSTS or GEOS, never hand-written. Point-on-surface (polylabel) for markers and labels. Area and length are geodesic. |
| Observations | **OGC O&M / SensorThings** | The model and names of the observation log. SensorThings export is later. |
| Serving | **OGC API Features 1+2+3 (+4 draft)** | Real conformance at `/api/p/<project>/ogc` (WP-110; the section below lists the claimed classes). CITE validation is not run in CI yet. |
| Exchange | **GeoPackage** | Import and export per view. Shapefile as zip import. |
| Map styling | **MapLibre Style Spec** | The stored style format. The builder UI generates it. |
| Tiles | **PMTiles** / MVT | Basemaps and offline packs. An offline pack is PMTiles plus a JSON manifest. |
| Forms | **ODK / XForms vocabulary** | `relevant`, `required`, `constraint`, `calculate`, `readonly`, `appearance`. XLSForm import is later. |
| Rules | **CEL** (subset) | `06-rule-language.md`. |
| Config | **JSON Schema 2020-12** | Generated from Zod and published, so editors get autocomplete (`# yaml-language-server: $schema=…`). |
| Versions | **SemVer** | Templates. Breaking changes are machine-checked. |
| Accessibility | **WCAG 2.2 AA as the design goal; the conformance claim is WCAG 2.1 AA per BITV 2.0 (B-011) / BITV 2.0 / EN 301 549** | A list alternative to the map, error summary with focus handling, non-drag alternatives, and axe checks in e2e. The KERN UX standard serves as the pattern reference. |
| Identity | **OIDC** (Keycloak, state IdPs), **WebAuthn/TOTP** | Admin login and MFA. SAML and SCIM only on demand. |
| API | **OpenAPI 3.1** (generated from Zod), **Standard Webhooks**, `Idempotency-Key` | Public API under `/v1`. |
| i18n | **ICU plural/select** through Paraglide for UI; `LocalizedString` for content | — |
| Ops | **OpenTelemetry**, structured JSON logs, `/healthz` `/readyz`, **Litestream** | — |
| Supply chain | **CycloneDX SBOM**, `security.txt` (RFC 9116), `SECURITY.md`, `publiccode.yml` | Needed for German public-sector procurement and OpenCoDE. |

## OGC API Features: what is claimed (WP-110)
Code: `packages/server/src/http/ogc`, mounted at `/api/p/<project>/ogc`. `GET .../conformance` is generated from `conformanceClasses` and claims only what is wired:
- Part 1 Core and GeoJSON: `/`, `/conformance`, `/collections`, `/collections/{type}`, `/collections/{type}/items` (`limit` up to 1000, `bbox`, keyset paging with `next`, `f=json`), `/collections/{type}/items/{id}`. A collection is a feature type the principal can see; rows are clipped by `SyncService.visible` and properties by the compiled permissions. Unknown query parameters are a 400.
- Part 2 CRS: CRS84, EPSG:4326 (lat/lon order) and the projected CRSs of the core registry (25832, 25833, 31466-31469); `crs`, `bbox-crs`, `Content-Crs` on writes. Seam: `CrsSeam`, real one in `core-seams.ts` (`fromWgs84`).
- Part 3 filter (CQL2 text and JSON, basic and basic spatial): built in `filter.ts` over the seam `Cql2Seam` (`fromCql2` plus `checkEnvFor`, real one in `core-seams.ts`). Terms `toSql` translates go into the WHERE; other terms (spatial) are evaluated in core on candidates and always need a bbox (the request's, or one derived from the geometry); above `RESIDUAL_SCAN_CAP` (5000, injectable as `residualScanCap`) candidates the request is refused (`filter_too_broad`).
- Part 4 (draft) create, replace, update, delete: POST, PUT, PATCH, DELETE become runs with the caller's own actor (an admin session records actor kind `admin`, a participant session or API token records `participant`, A-043, WP-402), planned and stamped under the version the feature follows (its pin, else the deployed one; A-029, WP-316). The task is `?task=` or the unique task the actor may run (create: it creates the type; update: its form covers the changed properties; delete: it has an own `lifecycle: deleted` step and every step without `of` is one, A-028); none or several is 422 `no_write_task` with the candidates (A-017), a participant's permission refusal is 403 `forbidden` (A-043).
- Validation against the OGC CITE suite is not run in CI (it needs a Java harness); the claimed classes are covered by `ogc.spec.ts`.

## Borrow ideas only (don't implement the standard)
- **BPMN / CMMN:** milestones as named derived states, timer and escalation on tasks, case lifecycle (suspend, reopen). CMMN itself is effectively dead as an industry standard.
- **DMN:** a decision-table editor on top of CEL, later.
- **Open311 GeoReport v2:** an adapter for defect-reporting projects, later.
- **Kubernetes:** the spec/status split. **Terraform:** plan before apply. **Replicache/Linear:** the sync model.

## Content Security Policy (apps/web)
Same-origin, except for map content: `default-src 'self'`, `script-src 'self'` plus a per-response nonce (SvelteKit `kit.csp`, nonce mode), no `'unsafe-inline'` for scripts; `style-src` still allows inline styles; `img-src` allows `data:` and `blob:` (a photo picked or taken on the device is shown from a `blob:` URL before upload), `worker-src` allows `blob:`. `connect-src` and `img-src` additionally carry the map origins (https only) of the deployed and preview project files: core `mapOrigins` reads the URLs of the layers the browser still fetches itself (remote `geojson`); layers the tile proxy serves (registry `MAP_SOURCE_TYPES.proxied`: `xyz`, `wms`, `preset`, `pmtiles`) need no CSP entry, because the browser asks only this server (WP-971), `apps/web/src/lib/server/security/map-origins.ts` keeps the set at server start and after every deploy (WP-957), and `widenCsp` (`security/headers.ts`) widens SvelteKit's page CSP with them, nonce untouched. The directives live once in `apps/web/src/lib/server/security/csp-directives.js`; pages get the nonce header from SvelteKit, every other response the same policy without a nonce. **Tool plug-ins (H1-H6) must never need inline scripts**: they ship as modules from the same origin. Unknown pages answer 404 with a small error page, unknown `/api/**` paths 404 JSON `{"error":"not_found"}`.

## Erasure in the run transaction (B-005, WP-142)
- Erasure is an ordinary run (A-021, R3): a task with a `redact` then-step. core's plan returns `PlannedRun.purge` and `erased` (one subject per `redact` step); for every planned run with a non-empty `purge` the run transaction (`submit` and `submitBatch` alike) calls `erase({ subject, purge, erasureRun, at })` once per subject, after the fold and inside the same transaction. Ordinary runs never reach `erase`. `erase` never runs outside that transaction, and a failing `erase` rolls the whole run back. Who may erase is the task's `when` rule (the config's roles), checked by plan like any task; there is no separate admin path and no `Store.submitErasure`. A repeated run id answers from the ledger and erases nothing.
- Blob bytes are deleted only after the commit (`StoreDeps.onOrphanedBlobs`, called once per committed batch with the ids of all its erasures, -> `BlobStore.delete`, idempotent). The commit already holds a `blob` tombstone per removed blob row, so a crash before the delete loses nothing: `createBlobSweeper` re-derives the pending set (tombstone without blob row, bytes still stored) and deletes at startup. A blob uploaded again after the erasure has a row and is left alone.
- `secure_delete` is set by `erase` on the connection; deleting a file does not shred its disk blocks (an object store or an encrypted volume is the answer there, H4).

### Blob bytes in the project store (WP-142.1, A-021)
- `projectStoresFor` deletes orphaned bytes after the commit and sweeps once when a project's store opens, because `ProjectStoresDeps.blobs` is required (an optional one would erase the database and silently keep personal bytes). The runtime keeps the bytes under `<dataDir>/blobs/<project>`. A failed delete never fails the erasure: it goes to `blobs.onError` (a loud `console.error` until WP-155 wires the logger), and the next start's sweep retries.

### Participant login needs a roster row (WP-175, A-025)
- A participant login needs a roster row: a QR for an id without one is refused at exchange with 401, and removing a participant ends their live session (A-025, supersedes A-014). `participantRolesOf` returns `null` for both a missing and a disabled row.

## Before selling to public bodies (checked in every tender)
These are tracked as the Phase 7 work packages in `process/roadmap.md`:
1. QR login hardened (C-002: v3's login stays): reusable participant tokens (stored readable, unique in the installation) with revocation, exchanged for a sliding session in an HttpOnly cookie (`ub_session_participant`; an admin session has its own cookie `ub_session_admin`, so both live side by side in one browser, WP-705) whose id is stored only as a hash; tokens never logged. The session slides 90 days and its cookie is re-set when it slides; a new sign-in on the same device revokes the old session (WP-608).
2. Backup and restore with a tested drill and documented RPO/RTO (Litestream).
3. GDPR package: data processing agreement (AVV) and TOM templates, per-subject export and deletion (crypto-shredding for the append-only log), retention periods.
4. Accessibility statement plus BITV self-assessment.
5. OIDC plus MFA for admins.
6. SBOM, security.txt, a vulnerability process, hardened container.
