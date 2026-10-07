# Berechtigungen pro Objektart

Jede Objektart hat einen Abschnitt `permissions` in der Projektdatei. Was nicht ausdrücklich erlaubt ist, ist verboten: fehlt eine Angabe, darf niemand die Aktion ausführen.

```yaml
permissions:
  see: { intern_notiz: [kontrolle] }
  visible_when: "self.zustaendig == actor.id || !('bauhof' in actor.roles)"
  create: [kontrolle]
  delete: [verwaltung]
  write: { vitalitaet: [kontrolle] }
```

- `see`, `create`, `delete`, `write` nehmen `$all` (jeder Akteur, auch ohne Rolle) oder eine Liste von Rollen.
- `see` als Liste oder `$all`: Nur diese Rollen sehen die Objekte, dann mit allen Eigenschaften.
- `see` als Zuordnung Eigenschaft zu Rollen: Jede Rolle sieht die Objekte; die genannten Eigenschaften sehen nur die aufgeführten Rollen, alle anderen Eigenschaften sehen alle.
- `write` als Zuordnung: Nicht genannte Eigenschaften darf niemand ändern.
- `visible_when` ist eine zusätzliche Bedingung pro Objekt (zum Beispiel *nur eigene Meldungen*). Ein Objekt ist sichtbar, wenn die Rolle es sehen darf und die Bedingung erfüllt ist.
- *Nur eigene*: `visible_when: "self.$created_by == actor.id"` zeigt jeder Person nur die Einträge, die sie selbst angelegt hat. Die Systemfelder `self.$created_by` (Erstellt von), `self.$created_at` (Erstellt am), `self.$changed_at` (Zuletzt geändert) und `self.$lifecycle` können in jeder Bedingung stehen. Ein Eintrag aus der Zeit davor erhält seinen Ersteller aus dem Lauf, der ihn angelegt hat.
- Löschen erfordert zusätzlich, dass die Rolle das Objekt sehen darf.
