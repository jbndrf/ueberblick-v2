# Demo-Instanz

Die Demo ist eine fertig befüllte Überblick-Installation zum Ausprobieren, im eigenen Netz. Sie zeigt drei Projekte mit Beispieldaten: Baumkataster (Musterstadt), Mängelmelder (Stadtwerke) und Veranstaltungsanträge (Ordnungsamt). **Nur zum Ansehen: nicht für den echten Betrieb.**

## Starten (für Betreiber)
`npm run demo` baut die App, befüllt beim ersten Mal die Daten und startet den Server. Danach steht eine Übersicht auf dem Bildschirm und in der Datei `DEMO.md` im Demo-Ordner (Standard `~/ueberblick-demo`). `npm run demo -- --reset` setzt die Beispieldaten zurück. Ihre Eingaben bleiben beim Neustart erhalten. Strg+C beendet die Demo.

## Anmelden als Teilnehmerin oder Teilnehmer
Die Übersicht enthält pro Projekt und Rolle einen Anmeldelink (zum Beispiel Anna, Baumkontrolle). Öffnen Sie den Link auf dem Gerät. Jeder Link gilt immer wieder, auch auf einem anderen Gerät. Die Anmeldung bleibt 90 Tage bestehen und verlängert sich bei jeder Nutzung. Weitere Links: `npm run demo -- --links`.

Der Browser warnt einmalig vor dem Zertifikat, weil es selbst ausgestellt ist. Wählen Sie im Browser Erweitert und dann Weiter. Ohne https funktioniert die App auf anderen Geräten nicht.

## Anmelden als Admin
Öffnen Sie `https://<Adresse>:4173/admin/login` und melden Sie sich mit E-Mail und Passwort an (beides steht in der Übersicht, einen Einmalcode gibt es nicht). Dann öffnen Sie ein Projekt, die Seite Teilnehmende, und kopieren einen Anmelde-Link oder exportieren QR-Karten.

## Was Sie zuerst ausprobieren können
1. Als Anna in der Liste einen Baum öffnen und die Regelkontrolle ausführen.
2. Die Karte: Einmal auf die Zahl eines Clusters tippen öffnet ein Blatt mit den Objekten dieser Gruppe, zweimal schnell tippen zoomt hinein.
3. Als Admin die Seite Teilnehmende öffnen und einen Anmelde-Link kopieren.
4. Unter „Ich“ Sprache und Darstellung wechseln.
5. Als Anna oder Vera unter Einstellungen, Optionen, Erweiterte Funktionen **Ansichten** und **Cluster** einschalten: das Blatt Karteninhalt zeigt dann die Reiter Ansichten und Cluster.
6. Eine Maßnahme öffnen: das Blatt zeigt den Pfad zum Baum. Ein Baum zeigt seine Maßnahmen als Liste (Baumart und Flächen sind nur Verweise und haben keine).

## Gut zu wissen
- Die Karte hat keine Hintergrundkarte aus dem Internet und funktioniert deshalb auch ohne Verbindung. Sie öffnet an der Startansicht des Projekts (im Baumkataster die ganze Stadt, die Bäume zeigen sich zuerst als ein Cluster).
- „Daten in Gefahr“ in der Kopfzeile heißt: Der Browser hat den Speicher nicht als dauerhaft zugesagt. Auf einem Demo-Gerät ist das normal.
