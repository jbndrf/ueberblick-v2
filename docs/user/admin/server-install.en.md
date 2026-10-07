# Starting the server

The server runs as a Docker container. It keeps everything in one data folder: `control.db` (accounts, sessions, templates) and one `project-<key>.db` file per project. You need Docker with Compose.

```bash
cp .env.example .env      # edit a few lines, see below
docker compose up -d      # builds the image and starts the app
```

The app then runs on the port `APP_PORT` (default `3000`). All data is in the folder `./data` next to `docker-compose.yaml`; back it up regularly. `docker compose down && docker compose up -d` keeps all data. To update, fetch the new version of the project folder and start with `docker compose up -d --build`.

To check that it runs: `docker compose ps` shows `healthy`, and `GET /api/health` answers `{"ok":true,...}`. With five projects the idle server uses about 110 MB of memory; the image is about 300 MB.

## Settings (`.env`)

All settings are in the file `.env`; `.env.example` lists every variable with a short explanation in German and English. An empty value counts as unset. At start the server checks every variable. If a required value is missing or a value is unknown (for example `HTTPS_MODE=foo`), it does not start and names the variable in its error message (`docker compose logs app`).

| Group | Variables |
| --- | --- |
| Address | `PUBLIC_URL` (required, no path), `HTTPS_MODE` (`proxy` or `direct`), `LOCAL_HOSTS` (`direct` only, then required), `HTTPS_PORT`, `HTTP_PORT`, `TRUSTED_PROXIES`, `APP_PORT` |
| First admin | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 10 characters; both or neither), `ADMIN_TOTP` (`off` or `on`) |
| Limits | `UPLOAD_LIMIT` (for example `50M`), `SESSION_DAYS_PARTICIPANT`, `SESSION_DAYS_ADMIN_REMEMBER` |
| Backup | `BACKUP_DIR` (see [Backups](backup.en.md)) |
| Advanced | `TIMERS_INTERVAL_S` |

- `TIMERS_INTERVAL_S`: how often the server looks for due time-based automatic actions, in seconds (default `30`; whole seconds only, `0` turns it off). A rule then fires up to that long after its due time.
- `UEBERBLICK_LOG_LEVEL` (not in `.env.example`): the lowest level the server writes to its log (`debug`, `info`, `warn`, `error`; default `info`). The log goes to standard output as one JSON line per event (`docker compose logs app`) and never contains values or run input.
- The container is fixed: data folder `/data` (the folder `./data`), port `3000` inside. It runs without root rights.
- `ADMIN_*`, `UPLOAD_LIMIT` and `SESSION_DAYS_ADMIN_REMEMBER` are in effect (see below). `HTTPS_MODE`, `LOCAL_HOSTS`, `HTTPS_PORT` and `TRUSTED_PROXIES` are in effect (see the HTTPS sections). `SESSION_DAYS_PARTICIPANT` takes effect in a following step.
- `UPLOAD_LIMIT` (default `50M`): a request whose body is larger gets `413` before the server reads it. The image also hands the value to the Node adapter (`BODY_SIZE_LIMIT`).
- HTTPS is required for the participant app, not only for the cookies. Browsers offer Web Locks (which let several tabs share one sync) only on secure pages. Opened over plain http from another device, the app stops and shows a notice with the https address instead of starting. `http://localhost` counts as secure.

## Behind a proxy

For a public address with a domain, put an HTTPS proxy (Caddy, Traefik, nginx, Coolify) in front of the app. The proxy ends HTTPS and passes requests on to the app.

In `.env`:

```
PUBLIC_URL=https://ueberblick.example.org
HTTPS_MODE=proxy
TRUSTED_PROXIES=172.16.0.0/12
```

- `PUBLIC_URL` is exactly the address people open in the browser. The app uses it to check that forms come from its own pages; you never set `ORIGIN` yourself. With `HTTPS_MODE=direct` forms also work from every address in `LOCAL_HOSTS`; a request for any other host name gets 421.
- `TRUSTED_PROXIES`: the addresses or ranges (CIDR) of the proxy. `X-Forwarded-For` and `X-Forwarded-Proto` count only from there. From any other address the app ignores these headers, so a device on the network cannot pose as another address. If the proxy runs in the same Compose network, the Docker network is right (often `172.16.0.0/12`); `docker network inspect` shows it.
- If `TRUSTED_PROXIES` is empty, the app trusts no proxy and counts the proxy's address as the client.
- Cookies are always `Secure`. Do not open the `APP_PORT` port to the internet (firewall), or the app can be reached around the proxy.

Caddy (`Caddyfile`; it sets the `X-Forwarded-*` headers itself):

```
ueberblick.example.org {
    reverse_proxy app:3000
}
```

Traefik (labels on the `app` service in `docker-compose.yaml`):

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.ueberblick.rule=Host(`ueberblick.example.org`)
      - traefik.http.routers.ueberblick.entrypoints=websecure
      - traefik.http.routers.ueberblick.tls.certresolver=letsencrypt
      - traefik.http.services.ueberblick.loadbalancer.server.port=3000
```

## Directly in your own network

With no domain and no proxy, the app serves HTTPS itself, for example for a team on the Wi-Fi.

In `.env`:

```
HTTPS_MODE=direct
LOCAL_HOSTS=192.168.1.20,ueberblick.local
HTTPS_PORT=8443
PUBLIC_URL=https://192.168.1.20:8443
```

Then `docker compose up -d`. On first start the server creates its own certificate authority (CA, valid about 10 years) in the data folder `./data/tls/`, and a server certificate for every address and name in `LOCAL_HOSTS`. The server certificate is valid for 397 days and renews itself before it expires; devices keep trusting only the CA. If you change `LOCAL_HOSTS`, the next start reissues only the server certificate; devices do not need to trust the CA again. Keep `./data/tls/ca.key` as safe as a password and never hand it out.

- The app is then reachable at `https://<address>:<HTTPS_PORT>`. If someone opens `http://<address>:<APP_PORT>`, the app redirects to https.
- `HTTP_PORT` (default 8080, `0` = off; whole numbers only): add the line `COMPOSE_FILE=docker-compose.yaml:docker-compose.direct.yaml` to `.env` for it, otherwise Docker does not publish the port (in proxy mode leave the line out, `docker compose up` works as before). To turn it off, set `HTTP_PORT=0` and leave the line out. Anyone who opens `http://<address>:<HTTP_PORT>` is sent to the same page on `https://<address>:<HTTPS_PORT>`. In proxy mode `HTTP_PORT` is ignored.
- `TRUSTED_PROXIES` does not apply in this mode.
- This is not a Let's Encrypt setup. For a public domain, use proxy mode.

### Installing the certificate on a phone

Every device must trust the CA once, or the browser warns and camera and offline use do not work. Open `https://<address>:<HTTPS_PORT>/setup/zertifikat` (German or English by the browser language; no sign-in needed). The browser warns about this one page: choose *Advanced* and open it anyway. The page shows public data only.

1. Download the certificate (`.crt`); on iPhone and iPad, the profile (`.mobileconfig`).
2. Follow the steps for Android, iOS, Windows or macOS on the page.
3. Reload the app: the warning is gone.

The QR code on the page leads to the page itself; print it to set up more devices.

## Setting up the first administrator

Put `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 10 characters) into `.env`. On first start the server creates exactly this account and logs `Admin angelegt: <e-mail>` (never the password). On every later start it leaves accounts alone: changing the variables afterwards has no effect. If there is no admin yet and the variables are missing, the server logs a hint and keeps running. Signing in: see `login.en.md`.

Further accounts and projects are created (until the interface arrives) on the command line (in the project folder, with `DATA_DIR` pointing at the container's data folder, that is `./data`):

```bash
export DATA_DIR=./data
npm run admin -- create-project musterstadt "Stadt Musterstadt"
UEBERBLICK_ADMIN_PASSWORD='at least ten characters' npm run admin -- create-admin admin@example.org
npm run admin -- confirm-totp admin@example.org 123456
npm run admin -- add-membership admin@example.org musterstadt verwaltung
npm run admin -- publish-template fixtures/golden/templates/baumkataster/1.0.0.yaml
```

The template file must be self-contained: if a layer's style points to a file (`{ "$ref" }`), the publish stops and names the layer. The example template in the repository contains such references.

1. With `ADMIN_TOTP=off` (the default) you need neither `confirm-totp` nor a code: `create-admin` is enough. With `ADMIN_TOTP=on` the admin enrols the one-time code at the next sign-in (see `login.en.md`); `confirm-totp` is then only an alternative.
2. `create-admin` prints an `otpauth://` address once (for `ADMIN_TOTP=on`).
3. The password is never passed as an argument, only through `UEBERBLICK_ADMIN_PASSWORD`, and it is never printed.
4. Then sign in with `POST /api/auth/login` (`email`, `password`, with `ADMIN_TOTP=on` also `totp`, optionally `remember`) and upload a configuration with `POST /api/admin/p/<project>/deploy`.

A signed-in admin without a confirmed TOTP (for example through OIDC) enrols it themselves with `POST /api/auth/totp/enrol` and `POST /api/auth/totp/confirm` (`{"code":"123456"}`). Once a TOTP is confirmed, `enrol` answers 409.

## Guess protection and security headers

- After 5 failed attempts within 15 minutes for the same combination of address and account (or QR code), login, QR exchange and TOTP confirmation answer `429` with `Retry-After`. A successful login resets the counter. A further limit of 30 failures per address applies.
- Behind a proxy, the real client address from `X-Forwarded-For` is counted once the proxy is in `TRUSTED_PROXIES` (see *Behind a proxy*).
- Every response carries `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(self), microphone=()` and (with HTTPS) `Strict-Transport-Security`. The policy is enforced, not report-only.
- The log has one line per request (`http.access`): method, route pattern (for example `/api/p/[project]/sync`, never the address itself), status, truncated client address and duration. It has no user agent and no query string.
- The log truncates client addresses (IPv4 to /24, IPv6 to /48) and never contains addresses with a query string (`?...`) or fragment: sign-in tokens live in addresses.
- The policy allows only same-origin content except remote GeoJSON files that projects configure. The server fetches map tiles (XYZ, WMS, PMTiles, presets) itself and serves them on, so they need no entry. Scripts run only with a one-time code (nonce) per page, never as free inline script. If you put a proxy in front, do not rewrite or add a `Content-Security-Policy` header.
- Unknown pages answer `404` with a short error page and a link to the app (`/` redirects to the sign-in or the map); unknown `/api/...` paths answer `404` with `{"error":"not_found"}`.

Note: a user interface for creating projects and accounts comes in a later step. Only remote GeoJSON addresses that a project configures are added to the policy automatically (https only). Map layers the server fetches and serves itself (tiles, WMS, PMTiles and the OpenStreetMap preset) need no entry. The policy takes these addresses from the deployed project files and from the live previews, and updates after every deploy. There is nothing to set in the installation. A device that is already installed picks up a newly allowed GeoJSON address the second time it starts online.
