# Werkzeuge in der App einer Rolle

Jede Rolle listet ihre Werkzeuge unter `roles.<rolle>.app.tools`. Ein Werkzeug, das die Rolle nicht aufführt, gibt es für diese Rolle nicht.

```yaml
roles:
  kontrolle:
    app:
      tools:
        search: { availability: active }
        measure: { availability: offered }
        photo: { settings: { maxEdge: 1600 } }
tools:
  search: { sources: [baum.befund] }
```

- **`availability: active`** (Standard): Das Werkzeug ist zunächst an. Die Person kann es in ihren Einstellungen ausschalten.
- **`availability: offered`**: Das Werkzeug ist zunächst aus. Die Person kann es in ihren Einstellungen einschalten.
- Eine Stufe, die ein Werkzeug dauerhaft eingeschaltet lässt, gibt es nicht.
- **Einstellungen:** `tools.<key>` enthält die Einstellungen für das ganze Projekt, `settings` im Eintrag einer Rolle die Einstellungen dieser Rolle; sie gehen vor. Eine Person kann Einstellungen nie ändern. Ein Werkzeug kann außerdem **Vorlieben** anbieten (zum Beispiel eine Einheit), die nur die Person ändert; die Einstellungen können ihren Startwert vorgeben.
- **Prüfung beim Veröffentlichen:** Die mitgelieferten Werkzeuge prüfen ihre Einstellungen. Eine Option, die das Werkzeug nicht hat, oder ein unpassender Wert stoppt das Veröffentlichen und nennt den Pfad (zum Beispiel `tools.photo["maxEdge"]`). Das Foto-Werkzeug kennt `maxEdge` (ganze Zahl von 16 bis 16384), `quality` (über 0, höchstens 1) und `allowLocation` (true oder false); das Suchwerkzeug kennt `sources`; Messen, Zeichnen und das Dateiwerkzeug haben keine Einstellungen.
