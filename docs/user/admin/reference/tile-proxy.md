# Kartenkacheln und Datenschutz (Kachel-Proxy)

Die Kartenbilder (OpenStreetMap, ein WMS, Ihre eigene Kachel-URL, eine PMTiles-Datei) kommen nicht vom Anbieter auf das Handy der Teilnehmenden. Der Server holt sie und reicht sie weiter. Der Anbieter sieht nur Ihren Server, nie die IP-Adresse oder den Browser einer teilnehmenden Person. Ohne das würde jeder Blick auf die Karte dem Anbieter verraten, wo Ihr Team arbeitet, und das ist ein Datenschutzproblem.

## Was es für Sie bedeutet
- **Nichts einzurichten.** Sie tragen die Adresse der Ebene wie bisher in der Projektdatei ein (`map.layers.<ebene>.source`). Der Server nutzt sie.
- **Schneller und günstiger.** Der Server behält die geholten Bilder (bis 2 GB, höchstens 30 Tage). Wer denselben Ausschnitt danach ansieht, bekommt ihn vom Server, und der Anbieter wird nur einmal gefragt.
- **Rücksicht auf den Anbieter.** Der Server schickt den Namen `Überblick/4 (+<PUBLIC_URL>)` mit Ihrer öffentlichen Adresse, damit der Anbieter Sie erreichen kann, wie es die OpenStreetMap-Kachelrichtlinie verlangt. Er fragt jeden Anbieter höchstens 2 Bilder gleichzeitig und 10 pro Sekunde, wartet, wenn der Anbieter um Geduld bittet, und versucht es bei Fehlern einige Male erneut.
- **Gleiche Sichtbarkeit wie die Ebene.** Wer eine Ebene nicht sehen darf (`roles` der Ebene), kann ihre Bilder auch nicht abrufen.
- **Neue Adresse, neuer Anfang.** Ändern Sie die Adresse einer Ebene, werden die Bilder der alten Adresse nicht mehr benutzt.

- **Nur öffentliche Adressen.** Der Server holt keine Ebene von Ihrem eigenen Server oder aus einem privaten Netz (Adressen wie 10.x, 192.168.x, 127.x oder 169.254.x), auch nicht, wenn ein Name oder eine Weiterleitung dorthin führt. Eine solche Ebene zeigt keine Bilder und scheitert in einem Offline-Paket mit diesem Grund. Nutzen Sie für die Ebene eine öffentliche Adresse.
- **Ebenen auf Ihrem eigenen Server.** Eine Adresse, die mit `/` beginnt (ein Pfad auf diesem Server, zum Beispiel `/tiles/stadt.pmtiles`), holt der Proxy nicht: Die Karte lädt sie direkt, denn sie verlässt Ihren Server nie. Ein Offline-Paket einer solchen Ebene wird über die öffentliche Adresse Ihres eigenen Servers gebaut. Ein Kachel, die Ihr Server nicht hat, fehlt einfach im Paket. Eine Adresse, die mit `//` (oder `/\`) beginnt, nennt einen anderen Server und wird wie jede Internet-Adresse behandelt.

## Offline-Pakete
Offline-Pakete aus OpenStreetMap-Ebenen und aus Ebenen mit Kachel-URL sind jetzt möglich: Der Server baut das Paket aus denselben Bildern und behält sie, so dass auch die nächste Ansicht dieses Gebiets keine Anfrage an den Anbieter braucht. WMS- und GeoJSON-Ebenen können nicht in ein Paket. Weil OpenStreetMap bittet, keine Karten in großen Mengen herunterzuladen, darf ein Paket höchstens 10.000 Kacheln einer Ebene von den OpenStreetMap-Servern enthalten. Ist es größer, bricht der Bau mit dem Grund ab; verkleinern Sie dann das Gebiet oder den Zoom-Bereich.

## Für den Betrieb
- Die Bilder liegen im Datenordner unter `tiles-cache`. Sie können den Ordner jederzeit löschen, er füllt sich wieder. Er braucht keine Sicherung.
- Ebenen mit einer URL im Internet brauchen diese Adresse vom Server aus erreichbar, nicht von den Handys der Teilnehmenden.
- Technische Referenz: `docs/decisions/later/A-033-tile-proxy.md`.
