# Erste Schritte

Sie brauchen ein Smartphone mit Browser und den QR-Code, den Ihnen die Verwaltung gegeben hat.

## Anmelden
1. Scannen Sie den QR-Code mit der Kamera. Der Link öffnet die Anmeldeseite und Sie sind nach einem Moment angemeldet. Die App zeigt gleich die Karte.
2. Der QR-Code (oder Ihr Zugangscode) gilt **immer wieder**, auf jedem Ihrer Geräte, bis er abläuft oder zurückgezogen wird. Meldet die App, dass der Zugang nicht mehr gilt, wurde er zurückgezogen, ist abgelaufen oder Ihr Konto ist gesperrt: Fragen Sie die Projektleitung.
   Ihre Anmeldung bleibt 90 Tage bestehen und verlängert sich bei jeder Nutzung. Melden Sie sich auf demselben Gerät mit einem anderen QR-Code an (zum Beispiel auf einem gemeinsam genutzten Handy), ersetzt das die bisherige Anmeldung; die Daten der vorherigen Person bleiben auf dem Gerät, werden aber nicht angezeigt.
3. Zum Anmelden brauchen Sie einmal Netz. Danach arbeiten Sie auch ohne (siehe [Offline arbeiten und Synchronisieren](offline-and-sync.md)).

### Ohne Kamera-Link: auf der Anmeldeseite
Öffnen Sie die Anmeldeseite (`/login`). Oben rechts stellen Sie Sprache und hell/dunkel ein; die Wahl bleibt auf dem Gerät.
- **Token-Anmeldung:** Tragen Sie Ihr Zugangstoken ein (das Auge zeigt es an) und tippen Sie auf „Anmelden“.
- **QR-Code:** Öffnen Sie den Reiter, tippen Sie auf „Kamera starten“ und halten Sie das Handy auf den QR-Code, oder laden Sie mit „QR-Bild hochladen“ ein Foto davon hoch. Ein erkannter Code meldet Sie sofort an. Auch ein ganzer Anmelde-Link im QR-Code funktioniert.

Bleibt das Feld leer, steht unter dem Feld „Bitte geben Sie ein Zugangstoken ein“. Die Seite scrollt nicht.

Fehlermeldungen: „Ungültiges oder abgelaufenes Token“ (Code falsch oder zurückgezogen), „Das Token ist abgelaufen“, „Dieses Konto ist inaktiv“, keine Verbindung und „Zu viele Anmeldeversuche. Bitte versuchen Sie es in {minutes} Minute(n) erneut.“

### Zustimmung und Rechtliches
Verlangt der Betreiber Ihre Zustimmung, erscheint auf der Anmeldeseite zuerst ein Fenster mit dem Hinweistext. Unten stehen die rechtlichen Seiten (zum Beispiel Impressum), die Sie dort lesen können („Zurück“ führt zum Hinweis). Mit „Akzeptieren“ geht es weiter, auch bei einem Anmelde-Link; mit „Ablehnen“ bleibt das Fenster offen, und Sie können sich nicht anmelden. Ihre Wahl gilt ein Jahr auf diesem Gerät. Die rechtlichen Seiten kann jeder ohne Anmeldung unter `/legal` und `/legal/<Name>` lesen.
### Als Gast beitreten
Hat die Verwaltung einen öffentlichen Link oder QR-Code für Gäste ausgegeben (zum Beispiel für einen Mängelmelder), öffnen Sie ihn: Die Seite „Als Gast beitreten“ fragt optional nach Ihrem Namen (leer: „Gast“), meldet Sie als Gast an und führt Sie zur Karte. Auf demselben Gerät führt der Link später zu Ihrem bestehenden Gast zurück. Gäste werden nach 90 Tagen ohne Aktivität deaktiviert; solange Sie die App nutzen, bleibt der Zugang bestehen. Verlangt der Betreiber Zustimmung, führt der Link zuerst zur Anmeldeseite mit dem Zustimmungsfenster und nach „Akzeptieren“ zurück zum Gast-Beitritt. Die Verwaltung kann begrenzen, wie viele Objekte ein Gast anlegen darf.

## Der erste Start
Beim ersten Öffnen lädt die App die Objekte Ihres Projekts auf das Gerät. Das kann bei großen Projekten einen Moment dauern; die Kopfzeile zeigt dabei „Daten werden synchronisiert (N)“. Danach sind die Objekte auch ohne Netz da.

## Was Sie sehen
Ihre Rolle bestimmt, was die App zeigt: die Werkzeuge (Suche …) und die Aufgaben. Was Ihre Rolle nicht braucht, sehen Sie nicht. Mehr dazu unter [Zurechtfinden](finding-your-way.md).

## Das Übliche in drei Tippen
- **Ein Objekt ansehen und eine Aufgabe ausführen:** Objekt auf der Karte (oder in der Liste) antippen, Aufgabe wählen, ausfüllen, „Absenden“. Auf der Karte gilt beim Antippen: zuerst ein Punkt, dann eine Linie, dann eine Fläche; ein Baum in einer Fläche öffnet also den Baum, ein Tipp auf die freie Fläche die Fläche.
- **Ein neues Objekt anlegen:** **+** in der Leiste, Aufgabe wählen, ausfüllen (den Ort setzen Sie auf der Karte: den Pin an die Stelle ziehen oder eine Linie oder Fläche zeichnen), „Absenden“.
- **Ohne Netz:** genauso. Das Formular schließt sich wie üblich; die Übermittlung wartet auf dem Gerät, bis die Verbindung wieder da ist. Die App sendet dann von selbst.

## Abmelden
Konto-Symbol oben rechts (oder „Einstellungen“ in der Leiste), Reiter „Profil“, „Abmelden“. Auf dem Handy erreichen Sie das Konto-Symbol auch bei offenem Formular. Beim Abmelden löscht die App Ihre Daten auf diesem Gerät, auch Ihre Offline-Kartenpakete, auch ungesendete Änderungen (die App fragt vorher). Ohne Verbindung geht Abmelden nicht. Das Blatt „Einstellungen“ fragt bei ungesendeten Änderungen vorher nach (siehe [Einstellungen](settings.md)). Auch die Adresse `/logout` beendet die Sitzung; danach sehen Sie die Anmeldeseite.

## Hinweise oben in der App
Findet die App einen Fehler in der Einrichtung, den sie nicht beheben kann, sagt sie es in einer roten Leiste oben, mit Kennung und Name: zum Beispiel eine Karte, die nicht lädt (`map_unavailable`; die Liste zeigt dieselben Objekte). Geben Sie die Meldung an die Administration weiter.

## Ihre persönlichen Einstellungen
Darstellung (Hell/Dunkel, Schriftgröße, Sprache), eingeschaltete Werkzeuge und gespeicherte Filter gehören zu Ihnen, nicht zum Gerät. Die Werkzeug-Schalter finden Sie unter „Einstellungen“, „Optionen“ (siehe [Einstellungen](settings.md)); die übrigen Einstellungen folgen Ihnen auf jedem Gerät, an dem Sie sich anmelden. Kartenpakete bleiben auf dem Gerät, bis Sie sich abmelden.
