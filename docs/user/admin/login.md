# Anmeldung

## E-Mail und Passwort
Admins melden sich unter `/admin/login` mit E-Mail und Passwort an (Passwort mindestens 10 Zeichen). Der erste Administrator kommt aus `.env` (siehe `server-install.md`).

- **Fehlermeldungen am Feld.** Eine ungültige E-Mail-Adresse oder ein Passwort unter 6 Zeichen wird rot markiert und unter dem Feld erklärt; abgeschickt wird erst, wenn beides stimmt.
- **Mehrere Tabs.** Melden Sie sich in einem Tab ab, gehen alle anderen Tabs im selben Browser zur Anmeldung zurück.
- **Einmalcode (TOTP) ist optional.** Standard ist `ADMIN_TOTP=off`: nur E-Mail und Passwort, das Feld *Einmalcode* ist ausgeblendet. Mit `ADMIN_TOTP=on` verlangt die Anmeldung zusätzlich den 6-stelligen Code einer Authenticator-App.
- **Einrichtung bei `ADMIN_TOTP=on`:** Wer noch keinen Code eingerichtet hat, lässt das Feld leer und meldet sich an. Nach dem richtigen Passwort erscheint einmal ein QR-Code (und der Schlüssel zum Abtippen) für die Authenticator-App. Mit dem ersten Code aus der App melden Sie sich erneut an; damit ist der Code bestätigt. Ein zweiter Aufruf ohne Code erzeugt einen neuen Schlüssel, der alte gilt dann nicht mehr.
- **30 Tage angemeldet bleiben:** Ohne Haken endet die Sitzung nach 12 Stunden, mit Haken nach `SESSION_DAYS_ADMIN_REMEMBER` Tagen (Standard 30).
- Nach 5 Fehlversuchen in 15 Minuten wartet die Anmeldung kurz (siehe `server-install.md`).

# Anmeldung mit einem OpenID-Connect-Anbieter

Neben E-Mail und Passwort (optional mit Einmalcode) können sich Admins über einen externen Identitätsanbieter anmelden (Keycloak, Azure AD, kommunaler IdP). Der Anmeldebildschirm zeigt pro eingerichtetem Anbieter eine Schaltfläche *Mit <Anbieter> anmelden* (der Bildschirm selbst kommt in einer späteren Phase).

## Anbieter einrichten (Betreiber)
Pro Anbieter legen Sie fest:
- **key**: Kurzname, Teil der Rückkehradresse.
- **issuer**: die Aussteller-URL des Anbieters. Sie muss dem `iss` jedes ID-Tokens entsprechen; die Endpunkte werden über `<issuer>/.well-known/openid-configuration` gefunden.
- **client id** und **Rückkehradresse** (dieselbe Adresse beim Anbieter eintragen).
- **Client-Secret**: nicht in der Konfigurationsdatei. Geben Sie den *Namen einer Umgebungsvariable* (`clientSecretEnv`) an, die es auf dem Server enthält.
- optional: Scopes (Standard `email`; `openid` wird immer gesendet) und erlaubte Signaturverfahren (RS256, ES256).

Der Ablauf ist Authorization Code mit PKCE (S256), State und Nonce. Die Signaturschlüssel des Anbieters werden automatisch geholt und 10 Minuten zwischengespeichert; ein Schlüsselwechsel beim Anbieter wird erkannt.

## Admin verknüpfen
Wer dem Anbieter bekannt ist, ist damit noch nicht angemeldet. Ein Betreiber verknüpft das Subjekt (`sub`) des Anbieters mit einem bestehenden Admin-Konto. Danach meldet sich die Person mit der Schaltfläche an und erhält eine normale Admin-Sitzung (12 Stunden, widerrufbar, durch Abmelden beendet). Die Mehrfaktor-Prüfung übernimmt der Anbieter, daher wird kein TOTP verlangt.

## Admins automatisch anlegen (optional, standardmäßig aus)
Setzen Sie eine **Anlegeregel** (ein Claim und der Wert, den er enthalten muss, z. B. `groups` = `ueb-admins`), erhält eine unbekannte Person mit passendem ID-Token bei der ersten Anmeldung ein Konto. Ohne Regel werden Unbekannte abgewiesen. Ein bestehendes Konto wird nie allein über die E-Mail-Adresse verknüpft. So angelegte Konten haben kein Passwort.

## Wenn die Anmeldung abgelehnt wird
Abgelaufene oder wiederholte Anmeldeversuche (älter als 10 Minuten), ein ungültiges ID-Token oder eine nicht verknüpfte Person führen zur Ablehnung. Starten Sie die Anmeldung neu; bei Wiederholung prüfen Sie Issuer, Client-ID, Rückkehradresse und die Secret-Variable.
