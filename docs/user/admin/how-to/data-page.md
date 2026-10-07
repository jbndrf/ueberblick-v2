# Die Daten einer Objektart ansehen

Klicke in der Seitenleiste unter „Objektarten“ auf eine Objektart. Die Seite zeigt alle Objekte dieser Objektart in einer Tabelle, auch bei Zehntausenden Objekten. (Tabellen haben eine eigene Seite, siehe *Tabellen anlegen und pflegen*.)

**Kopf:** der Name der Objektart, rechts „CSV importieren“, „Icons“ (der Icon-Designer, siehe [Icons und Farben](icons.md)), „Builder“ (öffnet den Builder dieser Objektart), „Aktualisieren“ (liest die Zeilen und die Namen der Teilnehmenden neu ein) und das Menü ⋮ (siehe *Duplizieren, importieren, löschen*).

- **Name und Beschreibung ändern:** Klicke auf den Namen oder die Beschreibung, tippe und bestätige mit Enter oder dem Haken. Escape oder das Kreuz bricht ab. Ein leerer Name wird abgelehnt.
- **Sichtbar für Rollen:** Klicke auf die Rollen unter der Beschreibung und wähle, welche Rollen die Objektart sehen. Ohne Auswahl sehen alle Rollen sie („Alle“). Ist die Sichtbarkeit pro Eigenschaft festgelegt, steht dort ein Hinweis; ändere sie dann im Builder unter Berechtigungen.
- **Vorfall oder Umfrage, Punkt, Linie, Fläche:** Die erste Marke sagt, ob die Objektart auf der Karte liegt (Vorfall) oder ein reines Formular ist (Umfrage); die zweite, welche Form Teilnehmende zeichnen. Klicke auf eine Marke, um zu wechseln. Hat die Objektart schon Objekte, steht eine Notiz da: Die Änderung gilt erst nach dem Veröffentlichen, und die Übersicht dort zeigt die betroffenen Objekte, die du verwerfen oder behalten kannst.
- **Private Einträge:** Ist der Schalter an, sehen Teilnehmende nur die Einträge, die sie selbst angelegt haben. Gilt schon eine eigene Sichtbarkeitsbedingung (Code-Ansicht), ist der Schalter gesperrt und die Bedingung steht darunter.

Jede Änderung geht in den Entwurf; die Leiste „Unveröffentlichte Änderungen“ erscheint, und erst „Veröffentlichen“ macht sie für alle wirksam.

**Spalten:**

| Spalte | Inhalt |
|---|---|
| Status | der Lebenszyklus: aktiv, abgeschlossen, archiviert, gelöscht |
| Stufe | die Stufe im Prozess der Objektart (nur wenn sie einen hat) |
| Erstellt von | der Name der Person; ein Admin steht mit seiner E-Mail-Adresse da, ein Import als „Import (E-Mail des Admins)“, automatische Aktionen und Zeitgeber als „System“; ist die Person nicht mehr in der Liste, steht ihre Kennung da |
| Standort | die Koordinaten (nur bei Objektarten mit Geometrie); Darüberfahren oder Antippen zeigt die Form auf der Basiskarte des Projekts |
| je Eigenschaft | eine Spalte, in der Reihenfolge der Objektart; Dateien zeigen Vorschaubilder (Klick vergrößert) |
| Erstellt | Datum und Uhrzeit |

Gelöschte Objekte sind zunächst ausgeblendet. Wähle im Filter der Spalte „Status“ den Wert **gelöscht**, um sie zu sehen.

Ein Feld mit der Quelle **Rollen** zeigt in der Tabelle den Namen der Rolle (ist die Rolle gelöscht, den Schlüssel).

**Suchen, sortieren, filtern** wie in jeder Liste (siehe *Eine Liste bearbeiten*). Der Server beantwortet jede Anfrage; der Filter einer Spalte zeigt die Werte aller Objekte mit Anzahl, nicht nur der geladenen Zeilen. Die Suche findet Teiltexte in Text-, Auswahl- und Zahlwerten und in der Kennung des Erstellers. Mehrfachauswahl-, Datei- und mehrsprachige Textspalten lassen sich nicht sortieren, auch die Standortspalte nicht; Datei-, mehrsprachige Text- und Standortspalten sowie „Erstellt“ lassen sich nicht filtern.

**Blättern:** Es gibt keine Seitenzahlen. Je 200 Zeilen werden nachgeladen, wenn du ans Ende scrollst; ein Kreisel zeigt das Laden.

**Noch nicht veröffentlicht:** Eine Objektart, die nur im Entwurf steht, hat noch keine Objekte; die Seite sagt es.

**Ein Objekt öffnen:** Ein Klick auf eine Zeile öffnet die Seite dieses Objekts (siehe *Ein Objekt ansehen*). „Zurück zu den Objekten“ bringt dich zur Tabelle mit derselben Suche, Sortierung und denselben Filtern zurück.

**Zellen korrigieren („Bearbeitungsmodus“):** Schalte oben in der Werkzeugleiste „Bearbeitungsmodus“ ein. Ein Klick auf eine Zelle öffnet sie; Enter übernimmt den Wert in der Zeile, aber speichert noch nichts. Die Zeile bekommt am Ende (Spalte „Aktionen“) einen Haken und ein Kreuz. Der **Haken** speichert alle geänderten Werte dieser Zeile **zusammen als einen Lauf**, die Aufgabe „Admin-Korrektur“; er steht danach in der Aktivität des Objekts mit deinem Namen und den Werten. Das **Kreuz** verwirft die Änderungen der Zeile; wer den Bearbeitungsmodus ausschaltet, verwirft alle ungespeicherten. Lehnt der Server einen Wert ab (zum Beispiel einen unpassenden Typ), zeigt die Zelle einen roten Rahmen mit dem Grund; die anderen Änderungen der Zeile bleiben zum Berichtigen. Hat jemand das Objekt inzwischen geändert, wird gar nichts gespeichert; aktualisiere die Seite und bearbeite die Zeile erneut. Regeln und berechnete Werte reagieren wie bei jeder Änderung.

Die **Stufe** ist nicht bearbeitbar (Hinweis beim Darüberfahren): sie ändert sich über Aufgaben, damit deren automatische Aktionen laufen. Zellen für Personen, Verweise, mehrsprachigen Text und Dateien sind noch nicht bearbeitbar.

## Duplizieren, importieren, löschen (⋮)

Ganz rechts im Kopf steht der Knopf **⋮ („Weitere Aktionen“)** mit drei Einträgen. Alle ändern nur den Entwurf; erst „Veröffentlichen“ macht sie für alle gültig.

- **Duplizieren:** kopiert die Objektart mit ihren Aufgaben, automatischen Aktionen und Ansichten unter dem Namen „<Name> (Kopie)“ in den Entwurf und öffnet die Kopie. Aufgaben, die Objekte einer anderen Objektart anlegen, werden nicht mitkopiert; die Meldung nennt sie. <!-- ui-strings-ignore -->
- **Aus Projekt importieren:** wähle ein anderes Projekt von dir (mit veröffentlichter Version) und eine seiner Objektarten. Die Objektart landet als Kopie im Entwurf. Beziehungen und Verweise auf Objektarten, die es in diesem Projekt nicht gibt, werden nicht übernommen, und Berechtigungen für Rollen, die es hier nicht gibt, entfallen; beides steht in einer Meldung. Prüfe danach die Berechtigungen im Builder.
- **Objektart löschen:** ein Dialog nennt, was mitgelöscht wird (Stufen, Aufgaben, automatische Aktionen, Ansichten, Objekte und erfasste Werte). Gibt es Objekte, musst du ihre Anzahl eintippen, bevor „Löschen“ frei wird. Die Objektart verschwindet aus dem Entwurf; **endgültig gelöscht wird sie erst mit „Veröffentlichen“**. Die Übersicht dort zeigt die betroffenen Objekte, und du entscheidest, ob sie verworfen werden. Danach öffnet sich die Seite der Projekteinstellungen. Verweist noch etwas auf die Objektart (zum Beispiel eine Beziehung einer anderen Objektart), meldet es der Dialog als Hinweis; behebe es im Builder, sonst lässt sich nicht veröffentlichen.

## CSV importieren

Rechts im Kopf steht **„CSV importieren“** (wie in v3). Es öffnet einen Assistenten mit vier Schritten:

1. **Hochladen:** wähle die CSV-Datei. Die erste Zeile enthält die Spaltenüberschriften; Semikolon, Komma und Tabulator werden erkannt.
2. **Zuordnen:** jede CSV-Spalte bekommt eine Eigenschaft der Objektart (oder „Überspringen“). Pflichtfelder sind mit * markiert und müssen zugeordnet sein; Spalten, deren Überschrift wie die Eigenschaft heißt, werden vorbelegt. Bei Objektarten mit Punkt gibt es die Spalten „Längengrad (lon)“ und „Breitengrad (lat)“ samt Koordinatensystem. **„In Stufe importieren“** legt alle Objekte in der gewählten Stufe an. Unter **„Wert für alle Zeilen“** bekommen weitere Eigenschaften in jeder Zeile denselben Wert, auch eine Rolle (Auswahl aus den Rollen des Projekts).
3. **Vorschau:** der Server prüft die Datei, ohne etwas zu schreiben: Zahl der fertigen Zeilen, die ersten Zeilen so, wie sie gespeichert würden, und die Probleme mit Zeilennummer. Regeln und Berechtigungen der Aufgabe prüft erst der Import; sie können weitere Zeilen ablehnen. Du wählst zwischen „Alles oder nichts: eine fehlerhafte Zeile lehnt die ganze Datei ab“ und „Fehlerhafte Zeilen überspringen und die übrigen importieren“. Das Ersetzen aller vorhandenen Daten löscht zuerst alle Objekte der Objektart und ist immer alles oder nichts: wird irgendetwas abgelehnt, bleibt der alte Bestand.
4. **Fortschritt:** ein Balken zeigt „n von m importiert“, dann das Ergebnis. „Zu den Objekten“ schließt den Assistenten, die Tabelle ist aktuell. Ein Import mit Alles oder nichts wird auf einmal geschrieben; der Balken springt dann am Ende.

**Noch nicht veröffentlicht:** Der Import läuft auf der veröffentlichten Version. Ist die Objektart noch nicht veröffentlicht, erklärt Schritt 3 das, und der letzte Knopf heißt **„Veröffentlichen und importieren“**: erst wird der Entwurf veröffentlicht, danach die Datei importiert. Eine Vorschau mit Prüfung gibt es dann nicht; Probleme einzelner Zeilen zeigt der Import danach an. Braucht das Veröffentlichen eine Wertverschiebung, schickt dich der Assistent zuerst in den Builder; es wird dann nichts importiert.

Dateien: nur CSV im Assistenten; GeoJSON legt der Assistent „GeoJSON importieren“ der Seitenleiste als neue Objektart an, GeoPackage nimmt die Schnittstelle (siehe *Daten importieren und exportieren*).
