# Ansicht auf der Karte gestalten

Eine Kartenebene einer Ansicht mit dem Renderer `maplibre-2d` kann einen `style` tragen: ein Objekt (oder `{ "$ref": "Pfad" }`) im Format der MapLibre Style Spec. Nur die Liste `layers` wird verwendet.

```json
{ "layers": [ { "id": "ub-single", "type": "circle", "source": "ub-clusters",
  "filter": ["!", ["has", "clusterId"]],
  "paint": { "circle-color": ["case", ["==", ["get", "status"], "open"], "#c53030", "#2f855a"] } } ] }
```

- **Ersetzen oder ergänzen:** Eine Ebene mit einer der Standard-Ids (`ub-shape-fill`, `ub-shape-line`, `ub-cluster`, `ub-cluster-count`, `ub-single`) ersetzt diesen Standard. Jede andere Id fügt eine Ebene hinzu, die unter den Darstellungs-Ebenen liegt und kein Objekt verdeckt oder einfärbt. Jede Ebene auf diesen beiden Quellen ist antippbar, egal welche Id sie hat.
- **Nur Einzelpunkte, Zähler oben:** Eine neu hinzugefügte Ebene auf `ub-clusters` zeichnet nur einzelne Punkte, nie die Gruppen (Sie brauchen dafür keinen Filter). Die Gruppenkreise und ihre Zahlen werden immer zuletzt gezeichnet und bleiben lesbar. Wollen Sie Gruppen anders gestalten, ersetzen Sie `ub-cluster` oder `ub-cluster-count`. Ein Filter einer neu hinzugefügten Ebene auf `ub-clusters` muss die Expressions-Syntax verwenden (z. B. `["==", ["get", "art"], "x"]`); die alte Syntax wird abgelehnt.
- **Quellen:** Nur `ub-clusters` (Gruppen: `clusterId`, `count`; einzelne Punkte: `featureId` und die Eigenschaften, die Ihr Style liest) und `ub-geometry` (Flächen und Linien; ihre eigenen Eigenschaften und `id`). Eigenschaften lesen Sie mit `["get", "key"]`.
- **Fehler:** Eine ungültige Ebene wird abgelehnt und mit ihrer `id` benannt; die Karte behält das bisherige Aussehen.
- **Style-Dateien:** `{ "$ref": "styles/name.json" }` verweist auf eine Datei im Projekt. Das Veröffentlichen bricht ab, solange der Stil einer Ebene ein solcher Verweis ist; der Stil muss dann direkt als Objekt im Projekt stehen. Sind die `layers` des Styles keine Liste von Objekten mit `id`, bricht das Veröffentlichen ebenfalls ab und nennt die Ebene.
- **Suchfelder:** Jeder Eintrag von `sources` beim Suchwerkzeug ist `Typ.Eigenschaft` und muss eine Text-, Auswahl-, Zahl- oder Ganzzahl-Eigenschaft dieses Typs nennen. Alles andere bricht das Veröffentlichen ab und nennt den Eintrag.

## Symbole und Farben nach Wert

Eine Objektart (`types.<art>`) legt fest, wie ihre Objekte auf der Karte aussehen, ohne dass Sie einen Style schreiben:

```yaml
marker: { color: "#2f855a", icon: { key: tree-deciduous } }     # das Aussehen der Objektart
classify:                                                        # ein Auswahlfeld (auch der Status)
  property: stage
  values:
    erfasst: { color: "#2b6cb0" }
    massnahme: { color: "#c05621", icon: { key: wrench } }
    melden: { color: "#d53f8c", icon: { $ref: icons/spielplatz.svg, size: 36 } }
```

- **Reihenfolge:** Wert (`classify.values`), dann `marker`, dann der einfache Punkt. Farbe und Symbol fallen einzeln zurück.
- **Symbole:** `{ key }` aus der Liste camera, check, circle-alert, clipboard-check, flag, house, info, leaf, map-pin, pencil, trash-2, tree-deciduous, triangle-alert, wrench (gezeichnet in der Farbe), `{ svg }` mit einem eigenen SVG oder `{ $ref: icons/name.svg }` mit einer Datei im Projekt (sie wird beim Einlesen eingebettet). `size` (8 bis 128, Vorgabe 32) ist die Größe in Pixel.
- **Das Merkmal:** `classify.property` ist ein Auswahlfeld der Objektart (kein Mehrfachfeld); jeder Eintrag von `values` muss eine seiner Optionen sein. Dasselbe Merkmal bestimmt die Schalter im Karteninhalt und die Zeilen im Gruppenblatt; ohne `classify` ist es der Status.
- **Prüfung:** Das Veröffentlichen bricht ab bei einem Merkmal, das kein Auswahlfeld ist, bei einem Wert, der keine Option ist, und bei einem SVG über 50 KB, mit Skript, Ereignis-Attributen, fremden Elementen oder einem Verweis nach außen.
- **Ersetzen:** Ersetzt Ihr Style die Standard-Ebene `ub-single`, `ub-shape-fill` oder `ub-shape-line`, bleibt diese Ebene so, wie Ihr Style sie schreibt.
- **Eine Objektart mit Aussehen nicht überzeichnen:** Hat eine Objektart ein Aussehen (`marker`, `classify`), ist es dasselbe wie im Filterblatt. Ein Style auf Ebenen dieser Objektart sollte ihre Punkte und Flächen nicht mit eigenen Kreisen, Flächen oder Linien übermalen, sonst weichen Karte und Filterblatt voneinander ab. Beschriftungen und andere Zusatzebenen sind in Ordnung. Die Beispielvorlagen tragen für Objektarten mit Aussehen keinen Style mehr.
