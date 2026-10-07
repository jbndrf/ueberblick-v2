# Open decisions: the owner decides

Agents: when a work package runs into one of these, **stop and report to the lead**, who asks the owner. Never pick one yourself. When a work package produces a recommendation (e.g. from a spike), the lead records it here as "recommended" and waits.

| ID | Question | Default until decided | Informed by |
|---|---|---|---|
| O1 | **Node or Bun** as the runtime? | Node 22 LTS | WP-020 benchmark |
| O2 | **Rule-language parser:** hand-written subset parser, or a CEL library (`@bufbuild/cel`, `@marcbachmann/cel-js`) behind our AST? | none: WP-020 prototypes both | WP-020 → provisional: hand-written (later topic A-003) |
| O3 | **Device storage:** keep IndexedDB, or move to SQLite-WASM on OPFS? | IndexedDB | measurements on a low-end Android device at 60k features |
| O4 | **DB per project** confirmed, or one shared DB? | per project | WP-100 |
| O5 | **Template chain depth** (owner → district → municipality)? | one level | — |
| O6 | **Geometry predicate library:** JSTS (pure JS) or GEOS-wasm? | JSTS | WP-030 parity fixtures |
| O7 | **Licence and open-core line** (which parts, if any, are commercial) | **Licence decided by the owner 2026-10-04: AGPL-3.0** (`LICENSE`, `publiccode.yml`). The open-core line (which parts, if any, are commercial) is still open | — |
| O8 | **Chat in v4.0 scope?** | out of core; module later | — |
| O9 | **Deploy target** (Docker image, single binary via `bun build --compile`, both?) | **Decided by the owner 2026-10-01:** Docker + one `.env`, HTTPS `proxy` or `direct` (C-002, `docs/research/v3-parity/step-1-plan.md`) | owner review |
| O10 | **Admin identity:** OIDC from day one, or accounts first? | accounts + TOTP first, OIDC in Phase 7 | — |
| O11 | **The exact schema of the project file** (WP-010 output) | — | WP-010, owner review required → provisional: A-002, A-004, A-005 |
| O12 | **Teams / groups** as a concept separate from roles (dispatch: "10 tasks to each of 3 teams")? | Not modelled yet, but the schema must not preclude it (H2) | WP-010 proposal |
| O13 | **3D stack** for CAD/BIM (renderer: CesiumJS, deck.gl, MapLibre custom layer, three.js; formats: OGC 3D Tiles, I3S, glTF, IFC conversion) | Not decided; keep the renderer registry open (H1) | a spike before Phase 4 ends |
| O14 | **Live positions / presence** for command centres: whether, how often, retention, consent | Not built; telemetry stays out of the observation log (H5) | — |
| O15 | **AI assistant authority:** read via views only, propose runs that a human confirms, or execute on its own under limits? | Read + propose only (H4) | — |
