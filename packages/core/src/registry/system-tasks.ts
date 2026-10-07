import { defineRegistry } from './define';

// Callers that import a key from here (plan) keep working; the barrel takes the keys from the lean module.
export * from './system-task-keys';

/**
 * Built-in tasks that no config declares: a run names one by key and only the `system` actor may start it
 * (docs/03 "life of a run"). The `$` prefix keeps them apart from config tasks.
 */
export const SYSTEM_TASKS = defineRegistry([
  {
    key: '$move',
    description:
      "Moves one feature's value after a deploy: an option to another option, or a property's value to another property (WP-307).",
    description_de:
      'Verschiebt nach einem Deploy den Wert eines Objekts: eine Option auf eine andere oder den Wert einer Eigenschaft in eine andere (WP-307).',
  },
  {
    key: '$seed',
    description:
      'Creates one demo feature of a type with any declared property values, the process stage and geometry included. Only the preview seeds it (WP-342).',
    description_de:
      'Legt ein Demo-Objekt einer Objektart mit beliebigen deklarierten Werten an, auch Stufe und Geometrie. Nur die Vorschau startet es (WP-342).',
  },
  {
    key: '$recompute',
    description:
      'Brings every computed property of one feature up to date. A deploy that adds or changes `computed` starts it per existing feature (WP-312).',
    description_de:
      'Bringt alle berechneten Eigenschaften eines Objekts auf den aktuellen Stand. Ein Deploy, der `computed` hinzufügt oder ändert, startet es für jedes vorhandene Objekt (WP-312).',
  },
  {
    key: '$pin',
    description:
      "Pins one feature to a config version (the reserved key `\$version`), or unpins it with a null version. A deploy that keeps a type's running features on the old version starts it per feature (WP-317, A-029).",
    description_de:
      'Heftet ein Objekt an eine Konfigurationsversion (Schlüssel `$version`) oder löst es mit leerer Version wieder. Ein Deploy, das laufende Objekte einer Objektart auf der alten Version belässt, startet es je Objekt (WP-317, A-029).',
  },
  {
    key: '$import',
    description:
      'Creates one feature through a creating task exactly as a normal run (form, then steps, defaults, process start) and then writes constant values on top, the stage included. Only the `import` actor may start it (WP-363).',
    description_de:
      'Legt ein Objekt über eine Erfassungsaufgabe an wie ein gewöhnlicher Lauf (Formular, Folgeschritte, Vorgaben, Start der Stufe) und setzt danach feste Werte darüber, auch die Stufe. Nur der Import-Akteur startet es (WP-363).',
  },
  {
    key: '$lifecycle',
    description:
      'Sets the system lifecycle of one feature (active, completed, archived, deleted), as the `lifecycle` then step does. Only the `system`, `import` and `admin` actors may start it; the import uses it to retire the old features when it replaces them (WP-363), an admin to delete a row (WP-382).',
    description_de:
      'Setzt den Lebenszyklus eines Objekts (aktiv, abgeschlossen, archiviert, gelöscht) wie der Folgeschritt `lifecycle`. Nur System, Import und Admin dürfen es starten; der Import setzt damit beim Ersetzen die alten Objekte auf gelöscht (WP-363), ein Admin löscht damit eine Zeile (WP-382).',
  },
  {
    key: '$correct',
    description:
      'Admin correction: an admin sets values of any declared property of one feature, except the process stage and system keys. Rules and computed values react as to any run. Only the `admin` actor may start it (WP-370).',
    description_de:
      'Admin-Korrektur: Ein Admin setzt Werte beliebiger deklarierter Eigenschaften eines Objekts, außer der Stufe und Systemschlüsseln. Regeln und berechnete Werte reagieren wie bei jedem Lauf. Nur der Admin-Akteur startet sie (WP-370).',
  },
  {
    key: '$create',
    description:
      'Admin creation: an admin adds one feature of a type with values for any declared property, the process start and defaults included (a row of a Tabelle). Required properties must have a value. Computed values follow; only the `admin` actor may start it (WP-382).',
    description_de:
      'Admin-Anlage: Ein Admin legt ein Objekt einer Objektart mit Werten für beliebige deklarierte Eigenschaften an, Start der Stufe und Vorgaben inbegriffen (eine Zeile einer Tabelle). Pflichtfelder brauchen einen Wert. Berechnete Werte folgen; nur der Admin-Akteur startet sie (WP-382).',
  },
] as const);
