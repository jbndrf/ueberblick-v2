# Projekteinstellungen

Die Seite **Projekteinstellungen** (Seitenleiste, unter dem Projekt) sammelt, was für das ganze Projekt gilt. Links steht eine Liste der **Bereiche**, rechts der gewählte Bereich. Auf dem Telefon steht die Liste über dem Bereich. Der gewählte Bereich steht in der Adresse (`?section=…`), ein Link oder ein Neuladen führt also zurück zum selben Bereich. Es erscheinen nur Bereiche, die es gibt; weitere folgen nach und nach.

Jede Änderung hier landet im **Entwurf** der Projektdatei. Die Veröffentlichen-Leiste zeigt **Unveröffentlichte Änderungen**, live ist die Änderung mit dem nächsten **Veröffentlichen**.

## Allgemein: App-Branding

Hier legen Sie fest, wie Teilnehmende das Projekt in ihrer App sehen.

- **App-Name**: der Name in der Kopfzeile der App. Leer lassen, dann gilt der Projektname (er steht als Platzhalter im Feld). **Speichern** übernimmt den Namen.
- **Symbol hochladen**: ein Bild (PNG, JPG, SVG oder WebP, höchstens 2 MB). Nach dem Auswählen zeigt die Vorschau das Bild; **Symbol hochladen** speichert es. Ist das Bild kein erlaubter Typ oder zu groß, nennt eine Meldung den Grund und nichts ändert sich.
- **Symbol entfernen**: erscheint, solange ein Symbol gesetzt ist.

Teilnehmende sehen Name und Symbol nach dem **Veröffentlichen**.

## Allgemein: Vorlage

Hier sehen Sie, auf welcher Vorlage das Projekt aufbaut, und passen die Eingaben an, die der Autor der Vorlage dafür vorgesehen hat (zum Beispiel einen Bezirksnamen oder ein Kontrollintervall).

- **Vorlage** und **Version**: der Name der Vorlage und ihre Versionsnummer, nur zum Lesen.
- **Eingaben der Vorlage**: je Eingabe ein Feld passend zum Typ (Zahl, Text, Datum, Schalter, Auswahl, Mehrfachauswahl, mehrsprachiger Text mit einem Feld je Sprache Deutsch und English) mit der Beschriftung und dem Hinweis der Vorlage. Zeigt das Feld den Wert der Vorlage, haben Sie nichts geändert. **Speichern** schreibt nur geänderte Werte in den Entwurf; setzen Sie einen Wert zurück auf den der Vorlage, entfällt Ihr eigener Eintrag wieder. Danach erscheint die Leiste „Unveröffentlichte Änderungen“, veröffentlichen lässt sich wie jede Änderung.
- Bietet die Vorlage keine Eingaben an, sehen Sie nur Vorlage und Version.
- Die mitgelieferten Vorlagen (Baumkataster, Mängelmelder, Veranstaltung) erklären jede Eingabe in einem Satz: was sie bewirkt und welche automatische Aktion oder Aufgabe sie steuert.
- Eingaben anderer Typen (zum Beispiel Geometrie) zeigt die Seite nur an; ein Hinweis sagt, dass sie sich hier nicht bearbeiten lassen.

## Karte: Kartenebenen

Hier legen Sie fest, welche Hintergrundkarten es gibt: **Basis**-Karten (eine ist gerade aktiv) und **Overlay**s (beliebig viele darüber). Die Zeile unter der Überschrift nennt die Basis-Layer, oder weist darauf hin, dass noch keiner da ist.

- **Layer hinzufügen** öffnet den Dialog „Kartenebene hinzufügen“ mit den Reitern **Voreinstellungen**, **Kachel-URL**, **WMS**, **Hochladen**, **PMTiles** und **GeoJSON**. Eine Voreinstellung ist ein Tippen: die erste wird Basis, jede weitere Overlay; schon vorhandene zeigen **Hinzugefügt**. Die anderen Reiter (außer **Hochladen**, siehe unten) fragen **Name**, die Adresse (bei **Kachel-URL** mit den Platzhaltern z, x und y; **PMTiles** auch als Pfad auf diesem Server), **Quellenangabe (optional)** und den Schalter **Als Basis-Layer festlegen**. Eine falsche Eingabe nennt die Meldung im Dialog.
- **Hochladen** bringt eigene Kacheln auf den Server: **Name**, **Kachelformat** (PNG, JPG oder WEBP, nur für ein ZIP; MBTiles und PMTiles nennen ihr Format selbst) und **Kacheldatei** (ZIP mit Kacheln als z/x/y.ext, MBTiles oder PMTiles). **Kacheln hochladen** sendet die Datei in Teilen mit einem Fortschrittsbalken („Wird hochgeladen...“), bricht eine Verbindung ab, geht es an der Stelle weiter, die der Server hat. Danach zeigt der Balken „Wird verarbeitet...“, der Server macht daraus ein PMTiles-Archiv. Ist es fertig, kommt die Ebene als Overlay in den Entwurf und der Dialog schließt. Eine abgelehnte Datei nennt den Grund (zu groß, zu viele Kacheln, ZIP zu groß entpackt, keine Kacheln, beschädigt, falsches Format ...). Ein Vektor-Archiv landet im Reiter **PMTiles**, dort tragen Sie den Quell-Layer ein. Grenzen: 2 GB je Datei, 3 offene Uploads je Projekt.
- Die Tabelle zeigt **Layer-Name**, **Typ**, **Deckkraft**, **Sichtbar für Rollen**, **Basis**, **Beim Start an**, **Reihenfolge** (die unterste Ebene zuerst) und **Abruf**: **Über den Server** heißt, dass die Karte der Teilnehmenden die Kacheln über den Kachel-Proxy dieses Servers lädt (siehe Kachel-Proxy), **Direkt** nicht. Mit **Bearbeitungsmodus** ändern Sie Name, Deckkraft, Rollen und **Beim Start an** direkt in der Zeile. Ohne Rollen sehen alle Rollen den Layer.
- Das Zeilenmenü bietet **Bearbeiten** (alle Einstellungen: Adresse, Quellenangabe, Deckkraft, Zoom-Bereich, Rollen, Standard-Basiskarte), **Als Basis setzen** / **Als Overlay setzen**, **Nach oben**, **Nach unten** und **Löschen** (mit Rückfrage). Ein Layer, den ein Offline-Paket enthält, lässt sich erst löschen, wenn er aus dem Paket genommen ist. Beim Löschen einer hochgeladenen Ebene entfernt der Server auch die Kacheldatei; solange die veröffentlichte Karte oder ein Paket sie noch nutzt, bleibt sie, und eine Meldung nennt wer.

Alles landet im Entwurf; Teilnehmende sehen die Änderung nach dem **Veröffentlichen**.

## Karte: Standardansicht

Hier legen Sie fest, wo die Karte für Teilnehmende öffnet und wie weit sie zoomen dürfen.

- **Standard-Zoom** und **Zentrum Breitengrad** / **Längengrad**: die Startansicht der Karte.
- **Min. Zoom** und **Max. Zoom**: die Grenzen des Zoomens (ganze Zahlen von 0 bis 24).

Die Felder zeigen, bis Sie etwas speichern, Vorschläge (Zoom 10, Zoom 1 bis 19, Mitte von Deutschland). Das Feld über dem Formular fasst die gespeicherte Ansicht zusammen. Ungültige Werte nennt eine Meldung unter dem Feld: Breitengrad nur von -90 bis 90, Längengrad von -180 bis 180, Zoom von 0 bis 24, und **Min. Zoom** ≤ **Standard-Zoom** ≤ **Max. Zoom**. **Standards speichern** schreibt die Werte in den Entwurf. Die Karte der Teilnehmenden wendet Min. und Max. Zoom an.

## Allgemein: Status & Freigabe

Zeigt, wo das Projekt steht, und stellt es live. Das Feld oben nennt den Zustand: **Entwurf — noch nicht veröffentlicht** (Teilnehmende sehen noch nichts), **Version n ist live — unveröffentlichte Änderungen** oder **Live — Version n**. Darunter steht je Objektart die Zahl der vorhandenen Objekte. Was das Veröffentlichen verhindert (Blocker), steht als rote Zeile unter der Objektart, mit einem Link **Im Builder öffnen**; Blocker ohne Objektart stehen unter **Projekt**. Solange es Blocker gibt, ist der Knopf gesperrt. **Live schalten** (beim ersten Mal) oder **Veröffentlichen** öffnet die Übersicht der Änderungen und stellt den Entwurf dort als neue Version live. Es ist derselbe Schritt wie der Knopf in der Veröffentlichen-Leiste. Ist alles live, führt **Versionen ansehen** zur Versionsliste.

## Allgemein: Erststart

Hier legen Sie fest, was Teilnehmende beim **ersten Öffnen** der Karte sehen. Die Auswahl gilt, solange die Person dort noch nichts selbst gewählt hat: Sobald jemand selbst Ebenen wählt oder im **Filter** etwas schaltet, bleibt diese Wahl erhalten – auch wenn Sie den Erststart später ändern.

- **Basisebene**: die Hintergrundkarte beim Start. **(erste Basisebene)** nimmt die erste in der Liste der Karte.
- **Overlay-Ebenen (beim Start an)**: welche Overlays beim Start eingeschaltet sind.
- **Startstellungen speichern** schreibt die Wahl in den Entwurf (bei jeder Ebene das Feld `on_at_start`).

Die Ebenen selbst kommen aus der Projektdatei (`map.layers`). Gibt es keine Overlays, steht „Keine Overlay-Ebenen vorhanden.“
- **Sichtbare Objektarten**: welche Objektarten beim Start auf der Karte sichtbar sind. **Alle** ist an, wenn jede Objektart an ist; dann sind die Kästchen gesperrt. Schalten Sie **Alle** aus, wählen Sie je Objektart ein Kästchen ab. Der Pfeil vor einer Objektart (nur wenn sie Phasen oder Werte hat) klappt **Phasen, die beim Start sichtbar sind** beziehungsweise **Werte, die beim Start sichtbar sind** auf: dort wählen Sie einzelne Phasen (oder die Werte der Klassifizierung) ab. Ohne Objektarten steht „Keine Objektarten.“ Nur Objektarten mit Ort auf der Karte stehen in der Liste.
- Gespeichert wird beim Typ `on_at_start: false` (aus) und `values_at_start` (die Werte, die an sind; fehlt es, sind alle an).

## Funktionen: Projekt-Chat

Hier schalten Sie den projektweiten Chat für Teilnehmende ein.

- **Projekt-Chat aktivieren**: der Schalter. Aus, dann ist der Chat für alle unsichtbar. Ein: der Chat gehört zum Projekt.
- **Im Chat zugelassene Rollen** (nur bei eingeschaltetem Chat): wählen Sie Rollen, um den Chat auf diese zu beschränken. **Leer = alle im Projekt**: ohne Auswahl haben alle Rollen den Chat. Andere Werkzeuge einer Rolle ändern sich dadurch nie.
- **Speichern** schreibt den Entwurf.

Beim Ausschalten entfernt der Entwurf den Chat samt den Rollen-Einträgen dafür; veröffentlichen lässt sich das wie jede Änderung. Schalten Sie den Chat wieder ein, haben ihn die Rollen, die ihn nach der Rollenregel bekommen; frühere Einschränkungen pro Rolle bleiben nicht erhalten.

## Funktionen: Infoseiten

Hilfe- und Rechtstexte, die Teilnehmende in der App unter Profil lesen.

- **Infoseite hinzufügen** öffnet das Formular: **Titel**, **Inhalt** (HTML; erlaubt sind Links, Absätze, fett, kursiv, Listen und Überschriften, alles andere wird beim Anzeigen entfernt) und **Sortierung** (0 oder größer; kleinere Zahlen stehen zuerst).
- Im Inhalt ersetzt die App je Person die **Variablen** `$token` (Zugangs-Token), `$loginlink` (Login-Link), `$qrtoken` und `$qrloginlink` (jeweils als QR-Code). Das Formular listet sie.
- Die Liste zeigt je Seite Titel, zwei Zeilen Text ohne HTML und die Sortierung. Der Stift bearbeitet, der Papierkorb löscht: ein zweiter Klick auf das rote **Löschen** bestätigt.
- Seiten, die die Vorlage mitbringt, stehen ebenfalls in der Liste; Bearbeiten und Löschen gelten nur für dieses Projekt.

Die Änderungen stehen im Entwurf; Teilnehmende sehen sie nach dem **Veröffentlichen**.

## Funktionen: Offline-Pakete

Kachelpakete einer Region, die Teilnehmende für die Arbeit ohne Netz herunterladen.

- **Paket erstellen** (gesperrt, solange das Projekt keine Kartenebene hat): **Paketname**, **Min. Zoom** und **Max. Zoom** (0 bis 22), **Region**, die Kartenebenen (alle packbaren sind vorgewählt; eine Ebene, die nicht gepackt werden kann, etwa WMS, ist grau) und **Sichtbar für Rollen** (leer: alle Rollen).
- **Region auf der Karte zeichnen** öffnet die Karte. **Rechteck**: auf zwei gegenüberliegende Ecken tippen. **Polygon**: Eckpunkte antippen und mit **Fertig** abschließen; gespeichert wird das Rechteck um die Eckpunkte, denn ein Paket ist ein Rechteck. Oben stehen Fläche und die geschätzte Kachelzahl bei den gewählten Zoomstufen. **Löschen** setzt die Auswahl zurück, **Bestätigen** übernimmt sie.
- Ein Paket über dem Limit (250 000 Kacheln oder 1 GB) wird nicht angelegt; die Meldung sagt, was zu tun ist.
- Die Tabelle zeigt **Name**, **Status**, **Zoom**, **Kacheln**, **Größe** und **Sichtbar für Rollen** (im **Bearbeitungsmodus** direkt änderbar). Die Zeile hat ein Menü mit **Löschen**.
- **Status**: **Entwurf** (noch nicht veröffentlicht oder seit dem Bau geändert), **In Warteschlange**, **Wird erstellt** (mit Fortschritt), **Bereit** (mit echter Kachelzahl und Größe) oder **Fehlgeschlagen** (mit dem Grund und **Neu bauen**). Der Bau beginnt mit dem **Veröffentlichen**; die Tabelle fragt alle 3 Sekunden nach.

Pakete stehen im Entwurf unter `map.packs` (siehe die API-Referenz zu den Offline-Paketen).

## Funktionen: Filter & Felder

Hier legen Sie fest, ob Teilnehmende die Karte nach Feldwerten filtern können, und bereiten fertige Filter vor.

- **Beim Start aktiv**: der Schalter **Alle Rollen** schaltet das Werkzeug „Ansichten“ (den Tab mit dem Filter-Editor in der Filteransicht) für jede Rolle beim Start ein oder aus. Darunter steht **Pro Rolle** ein Schalter je Rolle. „Beim Start an“ heißt: die Person sieht das Werkzeug gleich; „Angeboten, beim Start aus“: sie kann es in ihren Einstellungen einschalten. Hat eine Rolle das Werkzeug nicht, steht dort **Nicht angeboten**; Einschalten bietet es ihr an.
- **Filter-Presets**: fertige Filter, die Teilnehmende ihrer Rolle in der Filteransicht unter „Vom Projekt“ mit einem Klick wählen. **Neu** öffnet den Dialog: **Name**, **Gilt für Rollen** (anfangs alle Rollen) und **Filterbedingungen** mit demselben Filter-Editor wie in der App; der Editor bietet die Felder, die die gewählten Rollen lesen dürfen. Die Liste nennt je Preset die Zahl der Bedingungen und die Rollen. Der Stift bearbeitet ein Preset, der Papierkorb löscht es nach einer Rückfrage für alle seine Rollen.

Hat der Entwurf noch Probleme (siehe Problemliste im Builder), steht in der Liste ein Hinweis, und der Filter-Editor ist erst wieder verfügbar, wenn sie behoben sind.

## Funktionen: Cluster

Die Karte fasst nahe Objekte bei niedrigen Zoomstufen immer zu Gruppen zusammen (wie in v3: Objekte im Abstand von bis zu 80 px; oberhalb des **Max. Zoom** des Projekts, ohne Angabe 19, erscheint jedes Objekt einzeln). Das Werkzeug **Cluster** löst die Gruppen auf und zeigt einzelne Objekte. **Beim Start aktiv** schaltet es für alle Rollen (oder je Rolle) beim Start ein; ohne den Schalter ist es angeboten und die Person schaltet es in ihren Einstellungen ein.

## Integrationen: GIS-Zugang

Hier stellen Sie Zugriffstokens für QGIS und andere GIS-Programme aus. Ein Token gehört einem **Teilnehmer** und gibt QGIS dieselben Rechte wie diesem Teilnehmer (die Objektarten und Eigenschaften, die seine Rollen sehen dürfen). Oder es gehört Ihnen als **Admin** und hat Ihre Admin-Rechte, nur in diesem Projekt.

- **Token erstellen**: bei **Zugriff als** *Teilnehmende Person* (dann den Teilnehmer wählen) oder *Admin (meine Rechte)*, eine **Token-Bezeichnung** (zum Beispiel Mein Laptop QGIS) eingeben, optional **Läuft ab**, dann **Token erstellen**. Das vollständige Token erscheint **nur dieses eine Mal** mit **Kopieren**; gespeichert wird nur ein Fingerabdruck. Es beginnt mit `ubk_`.
- **Tabelle**: Bezeichnung (mit den letzten vier Zeichen), Teilnehmer (oder „Admin: <E-Mail>“), Erstellt, Zuletzt verwendet, Läuft ab. **Widerrufen** fragt nach und sperrt das Token sofort; QGIS-Verbindungen damit funktionieren nicht mehr. Wird ein Teilnehmer gesperrt, enden auch seine Token; ebenso die Admin-Token eines gesperrten oder gelöschten Admin-Kontos.
- **QGIS verbinden**: Die Verbindungs-URL steht im Bereich (`https://<Server>/api/p/<Projekt>/ogc`). In QGIS unter Authentifizierung `Basic` wählen, das Token als Benutzername eintragen, das Passwort leer lassen (siehe [QGIS verbinden](connect-qgis.md)).

Ein Token ist keine Anmeldung: Mit ihm lässt sich die App nicht öffnen. Ein Teilnehmer-Token liest **und schreibt**, mit genau den Rechten dieses Teilnehmers: QGIS darf nur anlegen und ändern, was der Teilnehmer auch in der App darf (siehe [QGIS verbinden](connect-qgis.md)).

## Gefahrenzone: Projekt löschen

**Projekt löschen** entfernt das Projekt mit allem, was dazugehört, endgültig: Objekte und ihre Geschichte, Teilnehmende, Dateien, Offline-Pakete, die Vorschau, Anmeldungen und Token. Der Dialog nennt vorher, was gelöscht wird (Objektarten, Rollen, Kartenebenen, Offline-Pakete, Infoseiten, Teilnehmende, Objekte). Zur Bestätigung geben Sie den **Projektschlüssel** ein (er steht in der Adresse, `/admin/projects/<Schlüssel>/…`); erst dann ist **Löschen** wählbar. Danach öffnet die Projektliste. Das Löschen können alle Admins des Projekts. Der Schlüssel wird nie wieder vergeben; ein neues Projekt mit demselben Namen bekommt einen anderen Schlüssel. Schlägt das Entfernen der Dateien fehl, beendet der Server es beim nächsten Start.

## Allgemein: Projekt & Freigabe

Status & Freigabe, Vorlage und Projektdatei stehen auf einem Bildschirm (die Einträge Status & Freigabe und Vorlage gibt es nicht mehr; alte Links führen hierher). Oben stehen Status und Veröffentlichen, darunter die Vorlage mit ihren Eingaben, darunter die **Projektdatei**.

- **Projektdatei**: die ganze Projektdatei des Entwurfs als Text. Sie können sie bearbeiten oder eine ganze Datei darüber einfügen und mit **Übernehmen** in den Entwurf übernehmen.
- Die Datei wird vollständig geprüft. Gibt es Probleme, werden sie mit ihrem Ort in der Datei aufgelistet und es wird nichts übernommen; **Zurücksetzen** holt den gespeicherten Stand zurück.
- Übernehmen verändert nur den Entwurf. Live geht erst etwas mit **Veröffentlichen**.

## Noch nicht vorhanden

