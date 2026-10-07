# Geometrie und Koordinatensysteme

Überblick speichert alle Geometrien in **WGS84** (Länge/Breite, 7 Nachkommastellen, etwa 1 cm). Höhenwerte (Z) bleiben erhalten.

## Import
Beim Import geben Sie das **Quell-Koordinatensystem** an: GeoPackage- und GeoJSON-Dateien mit `crs`-Angabe tragen es selbst, bei CSV wählen Sie es. Unterstützt:

- EPSG:25832 und EPSG:25833 (ETRS89 / UTM, die Standardwerte für Deutschland)
- EPSG:31466 bis EPSG:31469 (Gauß-Krüger, Zonen 2 bis 5)
- EPSG:4258 (ETRS89 geographisch) und EPSG:4326 (WGS84)

## Prüfung und Reparatur
Jede Geometrie wird geprüft. Mögliche Befunde: leer, ungültige Zahl, außerhalb des Wertebereichs, zu wenige Punkte, Ring nicht geschlossen, Selbstüberschneidung, Loch außerhalb der Fläche, überlappende Teilflächen. Falsche Ring-Richtung und offene Ringe werden automatisch korrigiert, Selbstüberschneidungen und überlappende Teilflächen nach Möglichkeit repariert. Was nicht repariert werden kann, wird mit dem Befund gemeldet.

## Berechnete Werte
Für jede Geometrie berechnet Überblick Umring (Bbox), einen **Punkt auf der Fläche** (für Symbole und Beschriftungen, liegt immer in der Fläche), den Flächenschwerpunkt (nur für Auswertungen), die Fläche in m² und die Länge in m (auf dem Ellipsoid gemessen).
