# Die Admin-Oberfläche

Nach der Anmeldung sehen Sie links die Seitenleiste und oben eine schmale Kopfzeile. Jede Admin-Seite erscheint in diesem Rahmen.

## Seitenleiste
- **Projekte** führt zur Projektliste (`/admin/projects`). Ohne geöffnetes Projekt stehen darunter „Ihre Projekte“, ein Eintrag pro Projekt.
- **Im Projekt:** der Projektname, dann Projekteinstellungen, Teilnehmende, Rollen, Beziehungen und Versionen, darunter die einklappbaren Gruppen **Objektarten** (alle Typen außer den Tabellen) und **Tabellen** (Typen ohne Geometrie und ohne Ablauf). Die Adressen sind `/admin/projects/<Projekt>/<Seite>`.
- **Objektarten und Tabellen:** jeder Eintrag zeigt sein Symbol; eine Objektart öffnet ihre Datenseite (siehe *Die Daten einer Objektart ansehen*), eine Tabelle ihre Tabellenseite (siehe *Tabellen anlegen und pflegen*); die Überschrift der Gruppe „Tabellen“ öffnet die Übersicht aller Tabellen; der aktuelle Eintrag ist hervorgehoben. Die Liste kommt aus dem Entwurf, neue und umsortierte Einträge erscheinen also sofort. Mit dem **+** der Gruppe legen Sie eine neue Objektart oder Tabelle an: Name eingeben, **Erstellen**, der Builder (Objektart) oder die Tabellenseite (Tabelle) öffnet sich, und die gelbe Leiste „Unveröffentlichte Änderungen“ erscheint. Objektarten ziehen Sie mit der Maus in die gewünschte Reihenfolge (eine Linie zeigt, wohin der Eintrag fällt); die Reihenfolge gehört zum Entwurf. Mit der Tastatur: Eintrag fokussieren und Alt + Pfeil hoch oder Alt + Pfeil runter. Auf dem Telefon öffnet die Seitenleiste als Blatt: Listen und **+** funktionieren dort, das Sortieren per Ziehen nicht.
- Seiten, die noch nicht fertig sind, zeigen „Diese Seite ist noch nicht portiert.“ im selben Rahmen.
- **Instanz-Einstellungen** steht am Ende der Seitenleiste unter einem Strich (siehe *Instanz-Einstellungen*): Zustimmungsfenster und Rechtsseiten der ganzen Instanz.
- Mit dem Knopf links in der Kopfzeile (oder Strg+B) klappen Sie die Seitenleiste ein und aus; auf dem Telefon öffnet er sie über der Seite.

## Unveröffentlichte Änderungen
Einstellungen, die das Projekt verändern (Rollen, Spalten, Objektarten im Builder), gehen zuerst in den **Entwurf**. Solange der Entwurf von der laufenden Version abweicht, steht unter der Kopfzeile jeder Projektseite eine gelbe Leiste „Unveröffentlichte Änderungen“ mit der Schaltfläche **Veröffentlichen**; in der Seitenleiste zeigt dieselbe Meldung ein gelbes Abzeichen unter dem Projektnamen (es führt zu Versionen).
- **Veröffentlichen** öffnet die Deploy-Übersicht (siehe *Ein Projekt bereitstellen*): was sich ändert, was mit laufenden Objekten und mit Werten entfernter Einträge geschieht, und das Bestätigen. Danach verschwinden Leiste und Abzeichen, und „Version n ist live.“ erscheint kurz.
- **Ein neues Projekt ist nicht live.** Bis zur ersten Veröffentlichung steht dort „Nicht veröffentlicht“; Teilnehmende sehen nichts. Die erste Veröffentlichung macht Version 1.
- **Probleme** (zum Beispiel ein Verweis auf eine Objektart, die es nicht gibt) verhindern das Veröffentlichen. Die Leiste nennt ihre Anzahl und führt mit „Im Builder öffnen“ zur Objektart; die Übersicht listet sie unter „Behebe zuerst:“ und „Gehe zu“ öffnet die Stelle.
- Verschiebt eine Änderung vorhandene Werte (zum Beispiel eine entfernte Option), fragt die Übersicht nach dem Ziel („verschieben nach“) oder „Werte verwerfen“.
- **Teilnehmende** gehören nicht zum Entwurf: Sie hinzuzufügen oder zu ändern wirkt sofort und macht die Leiste nicht gelb.

## Konto-Menü
Das Symbol oben rechts zeigt Ihre E-Mail-Adresse und bietet:
- **Design:** hell oder dunkel. Der Browser merkt sich die Wahl.
- **Sprache:** Deutsch oder English. Der Browser merkt sich die Wahl (Cookie).
- **Abmelden:** beendet nur die Admin-Sitzung. Eine Teilnehmer-Sitzung im selben Browser (zum Beispiel die Karte in einem anderen Tab) bleibt angemeldet, und umgekehrt.

## Änderungen ansehen
In der Deploy-Übersicht und im Projektstatus (Einstellungen, „Status & Freigabe“) zeigt **Projektdatei vergleichen** die ganze Projektdatei nebeneinander als Zeilenvergleich: links die live-Version, rechts der Entwurf, geänderte Zeilen stehen auf einer Zeile. Rot (links, mit Minuszeichen) = in der live-Version, aber nicht mehr im Entwurf; grün (rechts, mit Pluszeichen) = neu im Entwurf. Auf dem Handy scrollen Sie seitwärts. Unveränderte Abschnitte sind zugeklappt („n unveränderte Zeilen“, antippen zum Öffnen). Vor der ersten Veröffentlichung ist alles neu. Die Änderungsliste nennt zusätzlich in Klammern, was sich an einem Eintrag geändert hat (zum Beispiel `form.datum` bei einer Aufgabe).
