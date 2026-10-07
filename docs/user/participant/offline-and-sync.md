# Offline arbeiten und Synchronisieren

Sie können Aufgaben auch ohne Netz ausführen. Jede Übermittlung wird zuerst auf Ihrem Gerät gespeichert und sofort geprüft. Das Ergebnis sehen Sie auf der Karte, noch bevor der Server es kennt (Vorschau). Danach sendet die App Ihre Übermittlungen **nacheinander in der Reihenfolge, in der Sie sie gemacht haben**. Die Uhr des Geräts spielt dafür keine Rolle.

Ohne Netz meldet die App den Verbindungsfehler nur einmal je Offline-Zeitraum in der Browser-Konsole, nicht bei jedem Versuch.

## Was Sie sehen

| Anzeige | Bedeutung | Was Sie tun können |
|---|---|---|
| „Noch nicht übertragen: n.“ am Objekt (nach „Absenden“ schließt sich das Formular) | Die Übermittlung ist auf dem Gerät gespeichert und noch nicht beim Server. Gibt es kein Netz oder antwortet der Server nicht, geht nichts verloren: Die App versucht es mit wachsenden Pausen bis höchstens 5 Minuten erneut. | Verbindung herstellen. Die App sendet von selbst, beim Wiederverbinden und beim Zurückkehren in die App sofort. |
| Roter Balken: „Die Anmeldung ist abgelaufen …“ mit „Neu anmelden“ | Ihre Sitzung ist abgelaufen. Die Übermittlungen bleiben auf dem Gerät gespeichert. | Mit einem neuen QR-Code anmelden, dann sendet die App weiter. |
| Roter Balken: „Diese App-Version passt nicht zum Server …“ | Der Server spricht eine andere Protokollversion als Ihre App. Es wird nichts mehr gesendet, nichts geht verloren. | App aktualisieren, dann sendet sie weiter. |
| Roter Balken: „Die Synchronisierung ist angehalten: …“ | Das Gerät konnte nicht speichern, was der Server geschickt hat (zum Beispiel weil es voll ist). | Speicher freigeben und neu laden; bleibt es so, die Verwaltung informieren. |
| Roter Balken: „Diese Seite stammt aus einer älteren App-Version …“ | Die App wurde aktualisiert, während diese Seite offen war; Seite und Synchronisierung passen nicht mehr zusammen. | Die Seite neu laden. Nicht gesendete Übermittlungen bleiben auf dem Gerät. |
| Roter Balken: „Die Synchronisierung ist angehalten: …. Bitte laden Sie die App neu.“ | Der Synchronisierungsdienst im Hintergrund ist ausgefallen. Dieselbe Meldung steht im Blatt „Einstellungen“ unter Profil in der Verbindungskarte. | Die App neu laden. |
| „Abgelehnt“ am Objekt | Der Server oder Ihr Gerät hat eine Übermittlung abgelehnt. Die Liste der ungesendeten und abgelehnten Übermittlungen mit dem Grund steht im Blatt „Einstellungen“ unter Profil, „Ausstehende Änderungen“. | Siehe unten. |
| „Konfigurationsversion N gibt es nicht mehr; die Übermittlung wartet auf Prüfung.“ | Der Projektstand, mit dem Sie gearbeitet haben, existiert auf dem Server nicht mehr. Die Übermittlung bleibt erhalten. | Die Verwaltung informieren. |

## Wenn eine Übermittlung abgelehnt wird

Eine Ablehnung wird nur dann angezeigt, wenn der Server sie ausdrücklich mit einem Grund meldet (siehe [Wenn eine Übermittlung abgelehnt wird](refused-runs.md)). Ein Netzfehler, eine Zeitüberschreitung oder eine Fehlermeldung eines Zwischenservers lehnt nie etwas ab.

- Lehnt schon Ihr Gerät ab, bleibt das Formular mit Ihren Eingaben offen („Nicht möglich“). Lehnt der Server ab, bleibt die Änderung mit ihren Werten auf dem Gerät; beheben Sie die Ursache und senden Sie mit „Erneut senden“, oder „Verwerfen“ Sie sie. Eine Übersicht aller ungesendeten und abgelehnten Übermittlungen steht im Blatt „Einstellungen“ unter Profil, „Ausstehende Änderungen“.
- Folgen weitere Übermittlungen, prüft die App diese neu gegen den tatsächlichen Stand. Nur die, die jetzt nicht mehr gültig wären, werden ebenfalls abgelehnt. Alle anderen werden gesendet.
- Eine Sammelübermittlung (mehrere Änderungen, die zusammengehören) wird ganz oder gar nicht angenommen. Wird sie abgelehnt, sind alle ihre Änderungen abgelehnt.

## Wenn der Speicher voll ist

Ist das Gerät voll, meldet die App das sofort und speichert die Übermittlung nicht halb. Geben Sie Speicher frei und wiederholen Sie sie.

## Start ohne Netz

Die App merkt sich Ihren Namen, den Projektnamen, das Projektsymbol und das Ende Ihrer Sitzung. Starten Sie sie ohne Netz, zeigt sie dieselbe Kopfzeile und Ihr Profil wie zuletzt. Melden Sie sich ab oder wird die Sitzung beendet, wird das Gemerkte gelöscht. Beim Abmelden löscht die App auch die Daten dieser Person auf dem Gerät, einschließlich ihrer Offline-Kartenpakete. Endet Ihre Sitzung von selbst (sie läuft ab oder der Server lehnt sie ab), führt die App Sie zur Anmeldeseite; ungesendete Änderungen bleiben auf dem Gerät und werden nach der erneuten Anmeldung gesendet. Auch ein Start ohne Netz mit abgelaufener Sitzung öffnet die Anmeldeseite.

## App installieren und Updates
Die App startet auch ohne Netz, wenn Sie sie einmal mit Netz geöffnet haben: Beim ersten Öffnen speichert der Browser die App auf dem Gerät. Zum Installieren nutzen Sie die Funktion Ihres Browsers (die Funktion zum Hinzufügen zum Startbildschirm); die App öffnet dann im Vollbild auf der Karte.

Auf dem iPhone oder iPad gibt es keinen Installieren-Knopf: Die Karte unter Einstellungen > Offline zeigt dort die Schritte (in Safari Teilen, dann Zum Home-Bildschirm).

Neue Versionen der App holt sie von selbst. Sobald sie bereit ist, lädt die Seite neu. Ist gerade ein Formular offen, wartet die App damit, bis Sie es schließen; Ihr Entwurf bleibt erhalten.

Ein Entwurf mit Foto behält das Foto auch nach einem Neuladen der Seite. Die Bilddaten liegen auf dem Gerät, bis Sie den Entwurf verwerfen oder senden (dann übernimmt die Warteschlange sie); beim Abmelden werden sie gelöscht.

## Karte ohne Netz

Kartenkacheln lädt die App bei Bedarf aus dem Netz. Für Gebiete ohne Empfang laden Sie ein Kartenpaket vorab: Einstellungen, Reiter „Offline“, „Kacheln herunterladen“ (siehe [Einstellungen](settings.md)). Ein heruntergeladenes Paket wird sofort und bei jedem Start für die Karte verwendet. Kartenpakete gelten nur für Sie in diesem Projekt: Melden sich auf demselben Gerät andere Personen an oder öffnen Sie ein anderes Projekt, sehen sie Ihre Pakete nicht und löschen sie nicht; Pakete aus früheren Versionen müssen einmal neu geladen werden. Zoomen Sie weiter hinein, als das Paket reicht, zeigt die App die gröbere Kachel des Pakets vergrößert (unscharf). Ohne Paket oder außerhalb seines Gebiets bleibt die Karte leer, Ihre Objekte bleiben sichtbar.

## Zwei Tabs, zwei Personen

Ein Browser hat nur eine Anmeldung, auch wenn mehrere Tabs offen sind. Melden Sie sich in einem zweiten Tab als andere Person an (zum Beispiel über den QR-Code), wechselt der erste Tab sofort zu dieser Person. Eine noch nicht übertragene Änderung der ersten Person wird nicht unter dem Namen der neuen Person gesendet. Sie bleibt auf dem Gerät und wird übertragen, wenn sich die erste Person wieder anmeldet. Zwei Tabs derselben Person arbeiten ungestört nebeneinander.
