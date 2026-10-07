# Tabellen anlegen und pflegen

Eine **Tabelle** ist eine kleine Liste ohne Karte und ohne Ablauf, zum Beispiel Ausrüstung oder Straßen. Formulare können sie als Auswahl anbieten. Technisch ist eine Tabelle eine Objektart ohne Geometrie und ohne Prozess; jede Zeile ist ein Objekt.

## Wo du sie findest

In der Seitenleiste, Gruppe **Tabellen**. Ein Klick auf einen Eintrag öffnet die Seite dieser Tabelle. Ein Klick auf die Überschrift **Tabellen** öffnet die Übersicht aller Tabellen. Mit dem Pfeil davor klappst du die Gruppe ein. Mit dem **+** der Gruppe legst du eine neue Tabelle an (Name eingeben, **Erstellen**); die Seite der neuen Tabelle öffnet sich, und die gelbe Leiste „Unveröffentlichte Änderungen“ erscheint.

## Die Übersicht

Eine Tabelle mit je einer Zeile pro Tabelle: **Tabellenname** (der feste Schlüssel), **Anzeigename**, **Beschreibung**, **Hauptspalte** und **Sichtbar für Rollen** (leer heißt „Alle“). Wie in jeder Liste: Suche, Sortierung, Filter.

- **Tabellen inline bearbeiten:** Schalte den Schalter in der Werkzeugleiste ein, dann ändern Klicks auf Anzeigename, Beschreibung und Rollen die Tabelle direkt.
- **Tabelle erstellen:** Die letzte Zeile ist immer da. Trage Tabellenname (Kleinbuchstaben, Ziffern und Unterstriche, mit einem Buchstaben am Anfang), Anzeigename und Hauptspalte ein, optional Beschreibung und Rollen, und bestätige mit dem Haken. Die neue Tabelle hat die eine Spalte, die du als Hauptspalte benannt hast.
- **Zeilenmenü (⋮):** **Bearbeiten** öffnet einen Dialog (Anzeigename, Beschreibung, Hauptspalte, Rollen; der Tabellenname bleibt, weil Schlüssel sich nie ändern), **Struktur bearbeiten** öffnet die Seite der Tabelle, **Löschen** fragt nach und entfernt die Tabelle aus dem Entwurf.

## Die Seite einer Tabelle

**Kopf:** der Name, die Beschreibung und „Sichtbar für Rollen“ ändern sich an Ort und Stelle (Stift, dann Haken oder Enter; Escape bricht ab). **Aktualisieren** liest die Zeilen neu.

**Tabelle:** eine Spalte je Eigenschaft, in der Reihenfolge der Tabelle. Die **erste Spalte ist die Hauptspalte**; welche das ist, bestimmst du durch die Reihenfolge der Spalten. Eine Verweis-Spalte (im Builder angelegt) zeigt den Namen des verwiesenen Eintrags (das Anzeigefeld der Spalte), nicht seine ID.

- **Zeile hinzufügen:** Die letzte Zeile der Tabelle ist die Eingabezeile. Fülle die Zellen (Pflichtspalten zuerst), bestätige mit dem Haken. Eine Spalte mit Standardwert ist schon vorbelegt. Der Server prüft die Werte; ein abgelehnter Wert erscheint als Meldung, die Eingabe bleibt.
- **Zellen bearbeiten:** Schalte **Bearbeitungsmodus** ein. Ein Klick auf eine Zelle öffnet sie (eine Rollen-Spalte öffnet eine Auswahl aller Rollen des Projekts); Enter übernimmt den Wert in der Zeile. Der Haken der Zeile speichert alle geänderten Zellen der Zeile zusammen, das Kreuz verwirft sie (siehe *Die Daten einer Objektart ansehen*, Abschnitt Zellen korrigieren).
- **Zeile löschen:** Zeilenmenü (⋮), **Löschen**, bestätigen. Die Zeile verschwindet aus der Tabelle; sie steht weiter in der Aktivität.
- **Spalten verwalten:** Das **+** in der letzten Überschrift öffnet „Spalten verwalten“. Dort siehst du alle Spalten mit Typ (Text, Zahl, Datum, Ja/Nein), „Pflichtfeld“ und Standardwert. **Reihenfolge ändern:** Ziehe eine Spalte am Griff links an ihren Platz (eine Linie zeigt, wohin sie fällt), oder fokussiere den Griff und drücke Pfeil hoch oder Pfeil runter. Auf dem Telefon hat jede Spalte Pfeil-Knöpfe „Nach oben“ und „Nach unten“. Die oberste Spalte ist die Hauptspalte; jede Änderung wird sofort in den Entwurf geschrieben.
  - **Spalte hinzufügen:** Spaltenname, Datentyp, Standardwert, Pflichtfeld. Die neue Spalte steht ganz unten.
  - **Bearbeiten (Stift):** Name, Typ, Standardwert und Pflichtfeld ändern; der interne Schlüssel bleibt.
  - **Löschen (Mülleimer):** fragt nach; die Werte der Spalte verschwinden mit dem nächsten Veröffentlichen.
  - **Reihenfolge:** Ziehe eine Spalte am Griff an ihren Platz, oder fokussiere den Griff und drücke Pfeil hoch oder Pfeil runter; auf dem Telefon die Knöpfe **Nach oben** und **Nach unten**. Die oberste Spalte trägt das Kennzeichen „Haupt“.
  - Spalten anderer Typen (zum Beispiel Auswahl), die im Builder angelegt wurden, siehst du hier und kannst sie löschen und verschieben; ihren Typ bearbeitest du im Builder.

## Entwurf und Veröffentlichen

Alles an der Struktur, also Tabellen, Namen, Beschreibungen, Rollen und Spalten, ändert den **Entwurf** und erscheint in der Leiste „Unveröffentlichte Änderungen“. Neue Spalten sind in der Liste mit „neu, wird mit Veröffentlichen aktiv“ markiert; **nach dem Veröffentlichen** sind sie in der Tabelle und bearbeitbar. **Bekannte Einschränkung:** Ändert sich nur die Reihenfolge der Spalten, erkennt die Veröffentlichen-Leiste das noch nicht als Änderung; die neue Reihenfolge wird zusammen mit der nächsten anderen Änderung (zum Beispiel einer neuen Spalte) veröffentlicht. Eine Tabelle, die noch nie veröffentlicht wurde, zeigt statt der Zeilen einen Hinweis; die Spalten kannst du trotzdem schon festlegen.

Zeilen dagegen gelten **sofort**: Hinzufügen, Bearbeiten und Löschen sind Läufe (Admin-Anlage, Admin-Korrektur, Lebenszyklus gelöscht) und stehen mit deinem Namen in der Aktivität.

## CSV importieren

**CSV importieren** (Kopfzeile der Tabellenseite, vor „Aktualisieren“) lädt Zeilen aus einer CSV-Datei in die Tabelle. Es ist derselbe Assistent wie auf der Datenseite einer Objektart: Datei wählen, jeder CSV-Spalte eine Spalte der Tabelle zuordnen (oder **Überspringen**), in der Vorschau die Prüfung jeder Zeile ansehen, dann importieren. Eine Tabelle hat keine Koordinatenspalten und keine Stufe. Jede Zeile wird wie eine von Hand hinzugefügte Zeile angelegt (ein Lauf Admin-Anlage), mit denselben Prüfungen: Pflichtspalten brauchen einen Wert. Fehlerhafte Zeilen lehnen entweder den ganzen Import ab oder werden übersprungen, wie du es in der Vorschau wählst. **Alle vorhandenen Daten ersetzen (sonst anhängen)** gibt es wie bei Objektarten; die alten Zeilen werden dann gelöscht.
