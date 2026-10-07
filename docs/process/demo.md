# Demo instance (`npm run demo`)

One command builds the web app, seeds a demo data dir with three projects and serves it on the local network, so a person can click through the finished build from a phone or laptop. **Demo only, never a production setup** (WP-920).

```bash
npm run demo                                   # build, seed on first use, serve on https://0.0.0.0:4173
npm run demo -- --no-build                     # skip the web build (it must exist)
npm run demo -- --reset                        # wipe the data dir and seed it again
npm run demo -- --port 4200 --dir /srv/demo    # other port, other data dir (default ~/ueberblick-demo)
npm run demo -- --http                         # plain http, no certificate (see "Why https")
npm run demo -- --totp                         # says that the demo admin has no one-time code (exit 1)
npm run demo -- --links                        # print fresh participant links and exit
```

Flags: `--port` (4173), `--host` (0.0.0.0), `--dir`, `--reset`, `--no-build`, `--http`, `--totp`, `--links`. `--totp` and `--links` take the same `--dir`.

## What it does
1. **Build** `npm run build -w @ueberblick/web`, unless `--no-build` (then the build must exist).
2. **Seed** (only when the data dir has no `.demo-seeded` marker): `scripts/demo/ctl.ts seed` makes `control.db` with the admin and the roster through the e2e seeding (`apps/web/e2e/seed.ts`: `seedControl`, `rosterToken`), a short-lived loopback server takes the deploy of the three projects through `/api/admin/p/<key>/deploy` (`scripts/ui/admin-client.mjs`, shared with `ui.mjs seed`), then `ctl.ts populate` writes the sample data as runs: GeoJSON **import runs** (actor kind `import`) for the first features, then runs of the roles themselves (inspections, assessments, approvals) so stages, rules and open tasks look used. Ids are counters in UUID shape and the data comes from a seeded generator, so `--reset` gives the same feature ids and counts.
3. **Reuse** an existing data dir as it is: clicks survive a restart. A non-empty dir without the marker is refused (use `--reset` or another `--dir`).
4. **Serve** `apps/web/build/index.js` on `127.0.0.1` with a free port, behind a small door (`scripts/demo/front.mjs`) on `--host:--port`. Ctrl-C stops both cleanly. The server log is `<dir>/server.log`.
5. **Handout**: after `/api/health` is ok it prints the same text it writes to `<dir>/DEMO.md`: addresses, admin sign-in (`/admin`, e-mail and password), one reusable sign-in link per participant (`/login?token=…`, lands on `/map`), what to try first. `scripts/demo/handout.spec.mjs` fails when that text names a route that does not exist in `apps/web/src/routes`.

Projects (keys use `_`, project keys cannot contain `-`): `musterstadt_baeume` ("Baumkataster Musterstadt", tree cadastre, golden `musterstadt-baeume`), `stadtwerke_meldungen` ("Mängelmelder Stadtwerke", defect reports), `ordnungsamt_veranstaltungen` ("Veranstaltungen Ordnungsamt", event approvals). The seed writes the display name into the project row, so the participant header shows it (the demo templates set no branding name); each has one participant per role (`scripts/demo/plan.json`).

## Why https
Browsers give Web Locks and the service worker to secure origins only (https or `localhost`). Over plain http from another device the participant app stops and shows a notice that it needs https, with the https address (WP-595). So the door speaks https with a certificate from a small local CA (`scripts/tls/cert.mjs`, `loadTlsMaterial`: a CA and a server certificate for the machine's addresses, in `<dir>/tls`, renewed when the addresses change). The app serves the CA at `/setup/zertifikat` (it reads `<dir>/tls/ca.crt`), and the handout's first step is to open that page on each device and install the CA. This matters because Chromium registers the service worker (and so offline in "Einstellungen") only on a trusted origin; without the install the browser warns and offline fails. `--http` skips the certificate; then only `localhost` gets a working participant app. The app itself gets `HOST_HEADER`/`PROTOCOL_HEADER` (`x-forwarded-*`) so one server answers on every address, and Secure cookies (with `--http`: `UEBERBLICK_INSECURE_COOKIES=1`). Nothing in `apps/web` or `packages/server` changes.

## Admin sign-in
The demo signs in through the app's own `/admin/login` with e-mail and password only: the seed does not enrol TOTP (`seedControl(..., { totp: false })`; TOTP is optional, owner decision). The handout has the address, the published e-mail and password. `npm run demo -- --totp` only explains that there is no code. The seed deploys with an admin session that `ctl.ts session` opens, not through the sign-in form. `npm run dev` ([dev.md](dev.md)) seeds with the same function.

## Demo-only additions on top of the golden files
`scripts/demo/overlays.mjs` deploys the golden project files with one addition, its reason in the file: it embeds the `{ $ref: styles/x.json }` layer styles of each file with `scripts/embed-refs.mjs` (one mechanism, R1: the same walker the core uses at ingestion). The former search-tool patch is gone: the golden fixtures are valid `tools.search.sources` now, and compile embeds the styles.

## Background and stop
```bash
nohup npm run demo -- --no-build > ~/ueberblick-demo.out 2>&1 &   # start (the handout is in the .out file and in <dir>/DEMO.md)
kill "$(lsof -ti :4173)"                                    # stop: SIGTERM, the same clean shutdown as Ctrl-C
```

## Known limits
- No QR code in the terminal (no dependency-free encoder); the builder's Participants lens issues QR images.
- The map opens at each project's `map.start` (only without one does it fit the features or fall back to the default centre); it has no internet basemap, so it works offline.
- `musterstadt_baeume` data lies near Bonn, like the golden seeds.

Tested by `scripts/demo/demo.spec.mjs` (needs the web build; skipped with a message without it; about 2 minutes): health, admin login, three projects, at least 20 features each, every participant link signs in (also from the machine's LAN address), restart keeps data, `--reset` reproduces ids, `--http`.
