# Den Server starten

Der Server läuft als Docker-Container. Er speichert alles in einem Datenordner: `control.db` (Konten, Sitzungen, Vorlagen) und pro Projekt eine Datei `project-<schluessel>.db`. Voraussetzung ist Docker mit Compose.

```bash
cp .env.example .env      # wenige Zeilen anpassen, siehe unten
docker compose up -d      # baut das Image und startet die App
```

Die App läuft danach auf dem Port `APP_PORT` (Standard `3000`). Alle Daten liegen im Ordner `./data` neben der Datei `docker-compose.yaml`; sichern Sie ihn regelmässig. `docker compose down && docker compose up -d` behält alle Daten. Für ein Update holen Sie den neuen Stand des Projektordners und starten mit `docker compose up -d --build`.

Prüfen, ob der Server läuft: `docker compose ps` zeigt `healthy`, und `GET /api/health` antwortet mit `{"ok":true,...}`. Der Server braucht im Leerlauf mit fünf Projekten etwa 110 MB Arbeitsspeicher; das Image ist etwa 300 MB gross.

## Einstellungen (`.env`)

Alle Einstellungen stehen in der Datei `.env`; `.env.example` listet jede Variable mit einer kurzen Erklärung auf Deutsch und Englisch. Leere Werte gelten als nicht gesetzt. Beim Start prüft der Server jede Variable. Fehlt eine Pflichtangabe oder ist ein Wert unbekannt (z. B. `HTTPS_MODE=foo`), startet er nicht und nennt die Variable in der Fehlermeldung (`docker compose logs app`).

| Gruppe | Variablen |
| --- | --- |
| Adresse | `PUBLIC_URL` (Pflicht, ohne Pfad), `HTTPS_MODE` (`proxy` oder `direct`), `LOCAL_HOSTS` (nur `direct`, dann Pflicht), `HTTPS_PORT`, `HTTP_PORT`, `TRUSTED_PROXIES`, `APP_PORT` |
| Erster Administrator | `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mindestens 10 Zeichen; beide zusammen oder keins), `ADMIN_TOTP` (`off` oder `on`) |
| Grenzen | `UPLOAD_LIMIT` (z. B. `50M`), `SESSION_DAYS_PARTICIPANT`, `SESSION_DAYS_ADMIN_REMEMBER` |
| Datensicherung | `BACKUP_DIR` (siehe [Datensicherung](backup.md)) |
| Erweitert | `TIMERS_INTERVAL_S` |

- `TIMERS_INTERVAL_S`: wie oft der Server nach fälligen zeitgesteuerten Aktionen schaut, in Sekunden (Standard `30`; nur ganze Sekunden, `0` schaltet es ab). Die Regeln lösen dann bis zu dieser Zeit nach ihrem Termin aus.
- `UEBERBLICK_LOG_LEVEL` (nicht in `.env.example`): ab welcher Stufe der Server ins Protokoll schreibt (`debug`, `info`, `warn`, `error`; Standard `info`). Das Protokoll geht als eine JSON-Zeile je Ereignis auf die Standardausgabe (`docker compose logs app`) und enthält keine Werte oder Eingaben.
- Der Container ist fest eingerichtet: Datenordner `/data` (der Ordner `./data`), Port `3000` im Container. Er läuft ohne Root-Rechte.
- `ADMIN_*`, `UPLOAD_LIMIT` und `SESSION_DAYS_ADMIN_REMEMBER` sind wirksam (siehe unten). `HTTPS_MODE`, `LOCAL_HOSTS`, `HTTPS_PORT` und `TRUSTED_PROXIES` sind wirksam (siehe die HTTPS-Abschnitte). `SESSION_DAYS_PARTICIPANT` wird in einem folgenden Schritt wirksam.
- `UPLOAD_LIMIT` (Standard `50M`): Eine Anfrage, deren Inhalt grösser ist, beantwortet der Server mit `413`, bevor er sie liest. Das Image gibt den Wert auch an den Node-Adapter weiter (`BODY_SIZE_LIMIT`).
- HTTPS ist für die Teilnehmer-App Pflicht, nicht nur wegen der Cookies. Browser bieten Web Locks (damit mehrere Tabs eine Synchronisation teilen) nur auf gesicherten Seiten an. Wird die App von einem anderen Gerät über einfaches http geöffnet, startet sie nicht und zeigt stattdessen einen Hinweis mit der https-Adresse. `http://localhost` gilt als gesichert.

## Hinter einem Proxy

Für eine öffentliche Adresse mit Domain setzen Sie einen HTTPS-Proxy (Caddy, Traefik, nginx, Coolify) vor die App. Der Proxy beendet HTTPS und reicht die Anfragen an die App weiter.

In `.env`:

```
PUBLIC_URL=https://ueberblick.example.org
HTTPS_MODE=proxy
TRUSTED_PROXIES=172.16.0.0/12
```

- `PUBLIC_URL` ist genau die Adresse, die Leute im Browser öffnen. Daran prüft die App, dass Formulare von der eigenen Seite kommen; `ORIGIN` setzen Sie nie selbst. Mit `HTTPS_MODE=direct` funktionieren Formulare auch von jeder Adresse aus `LOCAL_HOSTS`; eine Anfrage für einen anderen Hostnamen erhält 421.
- `TRUSTED_PROXIES`: die Adressen oder Netze (CIDR) des Proxys. Nur von dort gelten `X-Forwarded-For` und `X-Forwarded-Proto`. Von jeder anderen Adresse ignoriert die App diese Köpfe, ein Gerät im Netz kann sich also nicht als fremde Adresse ausgeben. Läuft der Proxy im selben Compose-Netz, ist das Docker-Netz richtig (oft `172.16.0.0/12`); `docker network inspect` zeigt es.
- Ist `TRUSTED_PROXIES` leer, vertraut die App keinem Proxy und zählt die Adresse des Proxys als Client.
- Cookies sind immer `Secure`. Geben Sie den Port `APP_PORT` nicht ins Internet frei (Firewall), sonst erreicht man die App am Proxy vorbei.

Caddy (`Caddyfile`; setzt die `X-Forwarded-*`-Köpfe selbst):

```
ueberblick.example.org {
    reverse_proxy app:3000
}
```

Traefik (Labels am Dienst `app` in `docker-compose.yaml`):

```yaml
    labels:
      - traefik.enable=true
      - traefik.http.routers.ueberblick.rule=Host(`ueberblick.example.org`)
      - traefik.http.routers.ueberblick.entrypoints=websecure
      - traefik.http.routers.ueberblick.tls.certresolver=letsencrypt
      - traefik.http.services.ueberblick.loadbalancer.server.port=3000
```

## Direkt im eigenen Netz

Ohne Domain und ohne Proxy bietet die App HTTPS selbst an, zum Beispiel für ein Team im WLAN.

In `.env`:

```
HTTPS_MODE=direct
LOCAL_HOSTS=192.168.1.20,ueberblick.local
HTTPS_PORT=8443
PUBLIC_URL=https://192.168.1.20:8443
```

Dann `docker compose up -d`. Beim ersten Start legt der Server im Datenordner `./data/tls/` eine eigene Zertifizierungsstelle (CA, gültig etwa 10 Jahre) und ein Serverzertifikat für jede Adresse und jeden Namen in `LOCAL_HOSTS` an. Das Serverzertifikat ist 397 Tage gültig und erneuert sich selbst, bevor es abläuft; die Geräte vertrauen weiterhin nur der CA. Ändern Sie `LOCAL_HOSTS`, stellt er beim nächsten Start nur das Serverzertifikat neu aus; die Geräte müssen der CA nicht erneut vertrauen. Sichern Sie `./data/tls/ca.key` wie ein Passwort und geben Sie sie nie weiter.

- Die App ist dann unter `https://<Adresse>:<HTTPS_PORT>` erreichbar. Öffnet jemand `http://<Adresse>:<APP_PORT>`, leitet die App auf https um.
- `HTTP_PORT` (Standard 8080, `0` = aus; nur Ganzzahlen): Fügen Sie dafür in `.env` die Zeile `COMPOSE_FILE=docker-compose.yaml:docker-compose.direct.yaml` hinzu, sonst veröffentlicht Docker den Port nicht (im Proxy-Modus bleibt die Zeile weg, `docker compose up` läuft wie bisher). Zum Ausschalten setzen Sie `HTTP_PORT=0` und lassen die Zeile weg. Wer `http://<Adresse>:<HTTP_PORT>` öffnet, wird mit der gleichen Seite auf `https://<Adresse>:<HTTPS_PORT>` weitergeleitet. Im Proxy-Modus wird `HTTP_PORT` ignoriert.
- `TRUSTED_PROXIES` gilt in diesem Modus nicht.
- Dies ist kein Let's-Encrypt-Betrieb. Für eine öffentliche Domain nutzen Sie den Proxy-Modus.

### Zertifikat auf dem Telefon installieren

Jedes Gerät muss der CA einmal vertrauen, sonst warnt der Browser und Kamera und Offline-Betrieb gehen nicht. Öffnen Sie dazu `https://<Adresse>:<HTTPS_PORT>/setup/zertifikat` (Deutsch oder Englisch nach der Browsersprache; ohne Anmeldung erreichbar). Der Browser warnt vor dieser einen Seite: Wählen Sie *Erweitert* und öffnen Sie sie trotzdem. Die Seite zeigt nur öffentliche Daten.

1. Laden Sie das Zertifikat (`.crt`) herunter, auf dem iPhone und iPad das Profil (`.mobileconfig`).
2. Folgen Sie den Schritten für Android, iOS, Windows oder macOS auf der Seite.
3. Laden Sie die App neu: Die Warnung ist weg.

Der QR-Code auf der Seite führt zu ihr selbst; drucken Sie ihn aus, um weitere Geräte einzurichten.

## Ersten Administrator einrichten

Tragen Sie `ADMIN_EMAIL` und `ADMIN_PASSWORD` (mindestens 10 Zeichen) in `.env` ein. Beim ersten Start legt der Server genau dieses Konto an und schreibt `Admin angelegt: <E-Mail>` ins Protokoll (nie das Passwort). Bei jedem späteren Start fasst er Konten nicht an: ändern Sie die Variablen danach nicht mehr, sie wirken nicht. Gibt es noch keinen Administrator und fehlen die Variablen, schreibt der Server einen Hinweis und läuft weiter. Anmeldung: siehe `login.md`.

Weitere Konten und Projekte legen Sie (bis die Oberfläche folgt) über die Kommandozeile an (im Projektordner, mit `DATA_DIR` auf den Datenordner des Containers, also `./data`):

```bash
export DATA_DIR=./data
npm run admin -- create-project musterstadt "Stadt Musterstadt"
UEBERBLICK_ADMIN_PASSWORD='mindestens zehn Zeichen' npm run admin -- create-admin admin@example.org
npm run admin -- confirm-totp admin@example.org 123456
npm run admin -- add-membership admin@example.org musterstadt verwaltung
npm run admin -- publish-template fixtures/golden/templates/baumkataster/1.0.0.yaml
```

Die Vorlagendatei muss in sich vollständig sein: weist der Stil einer Ebene auf eine Datei (`{ "$ref" }`), bricht das Veröffentlichen ab und nennt die Ebene. Die Beispielvorlage im Repository enthält solche Verweise.

1. Mit `ADMIN_TOTP=off` (Standard) brauchen Sie weder `confirm-totp` noch einen Code: `create-admin` genügt. Mit `ADMIN_TOTP=on` richtet der Administrator den Einmalcode bei der nächsten Anmeldung selbst ein (siehe `login.md`); `confirm-totp` ist dann nur noch eine Alternative.
2. `create-admin` gibt einmalig eine `otpauth://`-Adresse aus (für `ADMIN_TOTP=on`).
3. Das Passwort wird nie als Argument übergeben, sondern über `UEBERBLICK_ADMIN_PASSWORD`, und nie ausgegeben.
4. Danach melden Sie sich mit `POST /api/auth/login` an (`email`, `password`, bei `ADMIN_TOTP=on` zusätzlich `totp`, optional `remember`) und laden eine Konfiguration mit `POST /api/admin/p/<projekt>/deploy` hoch.

Ein angemeldeter Administrator ohne bestätigtes TOTP (z. B. über OIDC) richtet es über `POST /api/auth/totp/enrol` und `POST /api/auth/totp/confirm` (`{"code":"123456"}`) selbst ein. Ist TOTP schon bestätigt, antwortet `enrol` mit 409.

## Schutz vor Raten und Sicherheits-Header

- Nach 5 Fehlversuchen innerhalb von 15 Minuten für dieselbe Kombination aus Adresse und Konto (bzw. QR-Code) antworten Anmeldung, QR-Tausch und TOTP-Bestätigung mit `429` und `Retry-After`. Eine erfolgreiche Anmeldung setzt den Zähler zurück. Zusätzlich gilt eine Grenze von 30 Fehlversuchen je Adresse.
- Hinter einem Proxy zählt die echte Client-Adresse aus `X-Forwarded-For`, sobald der Proxy in `TRUSTED_PROXIES` steht (siehe *Hinter einem Proxy*).
- Jede Antwort trägt `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(self), microphone=()` und (mit HTTPS) `Strict-Transport-Security`. Die Richtlinie wird durchgesetzt, nicht nur gemeldet.
- Das Protokoll enthält eine Zeile je Anfrage (`http.access`): Methode, Routenmuster (z. B. `/api/p/[project]/sync`, nie die Adresse selbst), Status, gekürzte Client-Adresse und Dauer. Es enthält keinen User-Agent und keinen Abfrageteil.
- Das Protokoll kürzt Client-Adressen (IPv4 auf /24, IPv6 auf /48) und enthält nie Adressen mit Abfrageteil (`?...`) oder Fragment: Anmelde-Token stehen in Adressen.
- Die Richtlinie erlaubt nur Inhalte derselben Herkunft, ausgenommen entfernte GeoJSON-Dateien, die Projekte einrichten. Kartenkacheln (XYZ, WMS, PMTiles, Voreinstellungen) lädt der Server selbst und liefert sie aus; sie brauchen keinen Eintrag. Skripte laufen nur mit einem einmaligen Code (Nonce) je Seite, nie als freies Inline-Skript. Setzen Sie einen Proxy davor, ändern oder ergänzen Sie den Header `Content-Security-Policy` dort nicht.
- Unbekannte Seiten antworten mit `404` und einer kurzen Fehlerseite samt Link zur App (`/` leitet zur Anmeldung oder zur Karte weiter); unbekannte `/api/...`-Pfade antworten mit `404` und `{"error":"not_found"}`.

Hinweis: Eine Oberfläche zum Anlegen von Projekten und Konten folgt in einem späteren Schritt. Nur entfernte GeoJSON-Adressen, die ein Projekt konfiguriert, nimmt die Richtlinie automatisch auf (nur https). Kartenebenen, die der Server selbst abruft und ausliefert (Kacheln, WMS, PMTiles und die OpenStreetMap-Voreinstellung), brauchen keinen Eintrag. Die Richtlinie übernimmt diese Adressen aus den eingespielten Projektdateien und den Live-Vorschauen und aktualisiert sich nach jedem Einspielen. In der Installation ist nichts einzustellen. Ein bereits installiertes Gerät übernimmt eine neu erlaubte GeoJSON-Adresse beim zweiten Start mit Verbindung.
