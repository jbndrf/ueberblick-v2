# Formulare ausfüllen

Eine Aufgabe mit Angaben öffnet ein Formular. Sie füllen es aus und tippen auf **Absenden**; die Änderung wird auf dem Gerät gespeichert und, sobald Sie online sind, übertragen. Danach sind Sie wieder beim Objekt. Haben Sie mit **+** ein neues Objekt angelegt (auch eines ohne Position auf der Karte, zum Beispiel eine Baumart), öffnet sich nach dem Absenden dessen Objektkarte; war die Objektart im Filter ausgeschaltet, wird sie wieder eingeschaltet.

## Wo das Formular erscheint

Das Formular öffnet sich im selben Fenster wie die Objektkarte: auf dem Handy von unten (zuerst auf voller Höhe, ein Tipp auf die Kopfzeile oder Ziehen macht es klein), ab 768 px als Seitenfeld rechts. Die Karte bleibt benutzbar. Der Titel ist die Objektart, zum Beispiel Baum. Unten klebt die Leiste mit den Schaltflächen: auf der ersten Seite **Abbrechen**, danach **Zurück**, dazu **Weiter** beziehungsweise **Absenden**. **Abbrechen** und das Kreuz schließen das Formular; ein begonnener Entwurf bleibt erhalten.

Beim Absenden zeigt die Schaltfläche „Wird gesendet…“ und alle Schaltflächen sind gesperrt. Sobald die Änderung auf dem Gerät gespeichert ist, schließt sich das Formular und Sie sind zurück beim Objekt, online wie ohne Netz. Dort steht „Noch nicht übertragen: 1.“, bis der Server sie angenommen hat, oder „Abgelehnt“ mit dem Grund (siehe [Wenn eine Übermittlung abgelehnt wird](refused-runs.md)). Lehnt schon Ihr Gerät die Änderung ab, bleibt das Formular mit Ihren Eingaben offen und ein rotes Feld „Nicht möglich“ nennt den Grund; **Schließen** blendet es aus, gespeichert wurde nichts. Hat eine Aufgabe keine Felder, heißt die Schaltfläche „Eintrag erstellen“.

## Seiten

Ein langes Formular hat mehrere Seiten. Oben stehen die Reiter, benannt von den Administratoren („Seite 1“, „Seite 2“ und so weiter, wenn eine Seite keinen Namen hat). Eine Seite mit Namen zeigt ihn als Überschrift über den Feldern, darunter eine kurze Beschreibung, wenn es eine gibt. Sie können jederzeit auf einen Reiter tippen. **Weiter** und **Zurück** blättern nur und prüfen nichts.

Erst **Absenden** prüft alle Seiten. Fehlt etwas, öffnet sich die erste Seite mit einem Fehler. Auf den Reitern zeigt ein roter Zähler, wie viele Angaben auf der Seite fehlen („{count} fehlen“). Der Zähler wird kleiner, sobald Sie etwas ausfüllen.

## Aufgaben mit mehreren Schritten

Manche Aufgaben bestehen aus mehreren Schritten, zum Beispiel erst ein Formular und dann der Standort. Oben steht „Schritt 1 von 2“. Jeder Schritt hat seine eigene Seite (ein Formular-Schritt behält seine Seiten und Tabs). **Weiter** geht zum nächsten Schritt, **Zurück** kehrt zum vorherigen zurück; Ihre Eingaben bleiben erhalten. Erst im letzten Schritt steht **Absenden**: dann wird alles zusammen als eine Übermittlung gespeichert.

- **Standort-Schritt:** Die Karte öffnet sich von selbst. Tippen Sie auf die Karte oder ziehen Sie den Punkt dorthin; das gilt auch innerhalb einer Fläche, die Fläche wird dabei nicht verändert. Oder zeichnen Sie die Form neu und bestätigen Sie den Standort. Mit „Standort auf der Karte wählen“ öffnen Sie die Karte später noch einmal. Ohne gewählten Standort geht es nicht weiter. Bei einem vorhandenen Objekt beginnt der Schritt an dessen Standort: Die Karte zeigt es in Straßenebene, der Punkt (oder die Form) liegt schon dort, der Schritt gilt als gewählt, und ein unveränderter Standort wird nicht neu gespeichert.
- **Schnell bearbeiten:** Ist „Schnell bearbeiten“ der einzige Schritt der Aufgabe, öffnet sich kein Formular. Die Karte des Objekts zeigt unter **Daten** die gewählten Angaben als Eingabefelder; die übrigen bleiben Text. **Speichern** sendet nur, was Sie geändert haben. Ein leer gemachtes Feld wird geleert. **Abbrechen** verwirft die Änderungen.

## Schaltflächen

Jede Aufgabe hat ihre Schaltfläche mit eigener Beschriftung, Farbe und eventuell einem Symbol. Hat die Verwaltung eine Rückfrage eingestellt, erscheint sie bei einer Aufgabe ohne mehrere Schritte sofort nach dem Tippen; **Fortfahren** startet die Aufgabe, **Abbrechen** nicht. Bei einer Aufgabe mit mehreren Schritten (zum Beispiel „Bearbeiten“: Daten und Standort) erscheint sie erst bei **Absenden**; **Fortfahren** speichert, **Abbrechen** lässt Sie im letzten Schritt, ohne dass etwas gesendet wird.

## Felder

- Ein roter Stern am Feld bedeutet: Pflichtfeld. Hilfetexte stehen unter dem Feld, Fehler ebenfalls.
- Felder, die die Verwaltung nebeneinander gestellt hat (links und rechts in derselben Zeile), sind halb so breit und stehen auch auf dem Handy nebeneinander.
- Ein leeres Feld kann einen grauen Beispieltext (Platzhalter) zeigen, der beim Tippen verschwindet. E-Mail-Felder zeigen eine Beispieladresse und auf dem Handy die Tastatur mit @.
- Datum-, Uhrzeit- und Datum-mit-Uhrzeit-Felder haben das Eingabefeld Ihres Geräts. Bei Datum mit Uhrzeit gilt die Ortszeit Ihres Geräts; gespeichert wird der genaue Zeitpunkt. Hat die Verwaltung ein Datumsfeld mit dem heutigen Datum vorbelegt, steht darin schon das heutige Datum; Sie können es ändern.
- Wechseln Sie bei offenem Formular die Sprache, passen sich die Feldbezeichnungen sofort an; Ihre Eingaben bleiben.
- Mehrsprachige Textfelder zeigen und ändern den Text in Ihrer Sprache; die Texte in den anderen Sprachen bleiben unverändert. Fehlt Ihre Sprache, sehen Sie die vorhandene Sprache, bis Sie tippen. Leer gemacht, entfällt nur Ihre Sprache.
- Felder, die nicht zur Situation passen, erscheinen gar nicht und kommen von selbst, sobald sie passen.
- Ein Feld kann eine Angabe eines verknüpften Objekts zeigen und ändern, zum Beispiel die Telefonnummer des Prüfers. Es ist mit „Aus <Objektart>“ gekennzeichnet und zeigt zuerst den aktuellen Wert. Was Sie ändern, wird mit derselben Übermittlung beim verknüpften Objekt gespeichert; dürfen Sie diese Angabe nicht ändern, wird die Übermittlung abgelehnt. Ein schreibgeschütztes Feld zeigt den Wert nur an. Gibt es das verknüpfte Objekt nicht (oder ist es nicht auf dem Gerät), erscheint das Feld nicht.
- Andere Dateien als Bilder fügen Sie mit der Schaltfläche Dateien hinzu (siehe Dateien hinzufügen).
- Fotos nehmen Sie im Feld selbst auf (die Knöpfe „Foto aufnehmen“ mit Kamera-Symbol und „Foto auswählen“ mit Bild-Symbol); sie werden mit der Aufgabe übertragen. Ein Feld kann mehrere Fotos aufnehmen, bis zum eingestellten Höchstwert. Alle Fotos erscheinen als Bilderleiste über den Knöpfen (in einer vollen Spalte drei auf einmal; mit den Pfeilen am Rand, dem Mausrad oder durch Wischen blättern Sie weiter); das x auf einem Bild entfernt es. Tippen Sie auf ein Bild, sehen Sie es groß: mit den Pfeilen oder den Pfeiltasten blättern Sie, Esc schließt. Noch nicht gesendete Fotos sehen Sie auch ohne Netz. Dieselben Bilder finden Sie später in der Objektkarte unter Daten.

## Auswahlfelder

Felder mit einer Liste von Antworten (eine Auswahl, mehrere Auswahlen, eine Person oder ein anderes Objekt) öffnen sich wie in v3.

- **Auf dem Handy** füllt die Liste den Bildschirm über einem unscharfen Hintergrund und endet oberhalb der Tastatur. Oben steht ein Suchfeld: Tippen Sie, um die Liste einzugrenzen (gesucht wird im Namen und in der Beschreibung). Tippen Sie auf einen Eintrag, um ihn zu wählen. Bei mehreren Auswahlen erscheinen die gewählten Einträge als kleine Marken im Suchfeld; das x auf einer Marke entfernt sie. **Fertig (n)** unten schließt die Liste, ein Tipp auf den Hintergrund auch.
- **Auf größeren Bildschirmen** öffnet sich eine kleine Liste unter dem Feld (darüber, wenn unten kein Platz ist). Der Cursor steht sofort im Suchfeld. Die Pfeiltasten bewegen die Markierung, Enter wählt, Rücktaste im leeren Suchfeld entfernt die letzte Marke, Esc schließt.
- **Person:** Beim Zuweisen und bei ähnlichen Feldern sehen Sie die Mitglieder des Projekts mit Namen, wenn Ihre Rolle das darf (so legt es das Projekt fest); sonst nur sich selbst, oder bei einer nicht erlaubten Rolle keine Auswahl. Die Liste kommt mit der Synchronisation und steht auch ohne Netz bereit. Ein Mitglied ohne Namen erscheint als „Jemand“.
- Bei einer Auswahl schließt ein Tipp auf einen Eintrag die Liste. Bei mehreren bleibt sie offen, bis Sie sie schließen.
- Das Feld zeigt den gewählten Namen, bei geschlossener Liste die Marken, und bei offener Liste „n ausgewählt“.

- **Abhängige Auswahl:** Hängt eine Auswahl von einer früheren Antwort ab (zum Beispiel die Sorte von der Gruppe), zeigt die Liste nur die dazu passenden Einträge. Solange das Feld, von dem die Auswahl abhängt, noch leer ist, steht statt der Auswahl der Hinweis „Zuerst einen Wert im abhängigen Feld auswählen“. Ein Eintrag kann einen Erklärungstext haben; er steht unter dem Namen. Ändern Sie die frühere Antwort so, dass Ihre bisherige Wahl nicht mehr angeboten wird, leert sich das Feld. Steht dort schon ein gespeicherter Wert, fragt „Felder werden geleert“ vor dem Absenden nach (siehe unten).
- **Zahlengrenzen:** Hat eine Zahl einen Mindest- oder Höchstwert, kennt schon das Eingabefeld diese Grenzen (Pfeiltasten und Bildschirmtastatur halten sich daran). Geprüft wird beim Absenden wie bisher.

## „Felder werden geleert“

Wenn Sie eine Antwort ändern, können andere Felder wegfallen, in denen schon ein Wert gespeichert war. Wenn **Absenden** solche Werte löschen würde, fragt die App vorher nach und listet die Felder auf. **Leeren & speichern** löscht die Werte und sendet ab. **Abbrechen** bringt Sie zurück ins Formular, nichts wird gesendet.

Den Ort setzen Sie auf der Karte (Pin oder Zeichnung, auch beim Verschieben eines Objekts). Das Formular zeigt ihn nicht als Zeile; er wird mit dem Absenden gespeichert.

Ein berechnetes Feld ist nie eingabefähig: Es zeigt, wenn es noch keinen Wert hat, den Hinweis "Wird beim Speichern berechnet" und die Marke "Berechnet". Der Wert wird nicht mitgeschickt.

## Felder eines verknüpften Objekts

Ein Formular kann ein Feld eines verknüpften Objekts zeigen und ändern, z. B. den Namen der Fläche eines Baums. Unter dem Feld steht, aus welcher Objektart es stammt. Beim Absenden wird der Wert auf dem verknüpften Objekt gespeichert. Ist das Objekt auf dem Gerät nicht vorhanden (offline, noch nicht synchronisiert), blendet das Formular diese Felder aus.
