# Als Admin anmelden und abmelden

Admins arbeiten im Admin-Bereich (`/admin`), Feldkräfte in der App (sie melden sich mit ihrem QR-Code an, siehe *QR-Login ausgeben und widerrufen*).

## Anmelden
1. Öffnen Sie `/admin/login`. Wenn Sie direkt eine Admin-Seite öffnen und noch nicht angemeldet sind, landen Sie hier und kommen nach der Anmeldung zu dieser Seite zurück. Adressen außerhalb dieser Installation werden ignoriert; dann landen Sie bei „Projekte“.
2. Tragen Sie E-Mail und Passwort ein und wählen Sie „Anmelden“. Mit dem Auge im Passwortfeld sehen Sie Ihre Eingabe. Ist `ADMIN_TOTP=on`, tragen Sie zusätzlich den 6-stelligen Einmalcode aus Ihrer Authenticator-App ein.
3. Sie landen in der Admin-Oberfläche (siehe *Die Admin-Oberfläche*). In der Seitenleiste stehen unter „Ihre Projekte“ die Projekte, in denen Ihr Konto eine Rolle hat.

Oben rechts auf der Anmeldeseite wechseln Sie Sprache und Design (hell oder dunkel).

Ein Einmalcode gilt nur einmal. Schlägt die Anmeldung fehl, erscheint eine Meldung, die nicht verrät, ob Passwort oder Code falsch war. Nach mehreren Fehlversuchen müssen Sie kurz warten.

## Erste Anmeldung
Ohne Einmalcode (`ADMIN_TOTP=off`, Standard) melden Sie sich direkt an. Mit `ADMIN_TOTP=on` richten Sie den Einmalcode bei der Anmeldung selbst ein: Das Feld leer lassen und anmelden; nach dem richtigen Passwort zeigt der Anmeldebildschirm einmal einen QR-Code (und den Schlüssel zum Abtippen) für Ihre Authenticator-App. Melden Sie sich mit dem ersten Code aus der App an; damit ist der Code bestätigt. Der Betreiber kann den Einmalcode alternativ beim Anlegen des Kontos bestätigen (`npm run admin -- confirm-totp <E-Mail> <Code>`).

## Abmelden
Öffnen Sie oben rechts das Konto-Menü und wählen Sie „Abmelden“. Die Sitzung endet, und Sie sehen wieder die Anmeldeseite.

Haben Sie ein Konto, aber in keinem Projekt eine Rolle, zeigt die Seitenleiste „Noch keine Projekte“; der Betreiber ordnet Sie einem Projekt zu (`add-membership`).
