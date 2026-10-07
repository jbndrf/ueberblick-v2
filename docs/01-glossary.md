# 01 · Glossary (binding)

Use these words in code, docs, UI copy keys and commit messages. **Do not introduce synonyms.** The glossary lint (`scripts/glossary-terms.json`) enforces the banned list at the bottom.

The vocabulary is layered:
- **Data and API** use OGC/GIS words.
- **Process** uses case-management words.
- **Participants** see neither. They see the labels from the project config (Baum, Kontrolle …).

| Term | Meaning | External equivalent | Generic German UI |
|---|---|---|---|
| **Project** | A template version plus an overlay, together with its data. One SQLite file. | — | Projekt |
| **Template** | A published, immutable, semver-versioned project blueprint. | Helm chart, Salesforce managed package | Vorlage |
| **Overlay** | What a project adds, overrides or hides relative to its template. | Kustomize overlay, Frappe Property Setter | Anpassungen |
| **Feature type** | The shape of features: properties, geometry, relations, permissions. Config key `types`. | ISO 19109 feature type; OGC API `collection` | Objektart |
| **Feature** | One thing (a tree, an area, a defect). Geometry is optional. | OGC / GeoJSON Feature | Objekt |
| **Lifecycle** | The system status of a feature (registry `LIFECYCLE_STATES`): `active`, `completed`, `archived`, `deleted`. Starts `active`, set only by the `lifecycle` then step (the reserved key `$lifecycle`), always through a run. `archived` and `deleted` features are not served to devices and accept no run (`case_closed`); `completed` ones still do. | — | Status |
| **Property** | A value on a feature, addressed by key. Stage, geometry and assignee are properties too. | GeoJSON `properties` | Eigenschaft |
| **Process** | The one process of a feature type (Objektart): `types.<t>.process: { property, start, end }`. Its stage property is a `select` of the type, `start` is the stage a new feature gets, `end` lists the stages that finish it. A type has at most one. | BPMN process, case-management stage | Ablauf |
| **Stage** | The value of the process property of a feature (for example `erfasst`, `erledigt`): one option of that `select`. Only `then.set` steps change it. | case stage | Stufe |
| **Property type** | The kind of a property (`text`, `number`, `select`, `date`, `geometry`, `participant`, `reference`, `file` …). Registered in core. | — | Feldtyp |
| **Observation** | One value of one property of one feature at one time, by an observer, through a task. Append-only. | OGC O&M / SensorThings Observation | (not shown) |
| **Field** | An input in a task's form, bound to a property. | ODK / XForms field | Feld |
| **Task** | A defined way to change features: `on`, `bind`, `form`, `then`. | CMMN (discretionary) task | Aufgabe |
| **Task step** | One part of a multi-step task, in order, submitted together as one run: a `form` step, a `quick_edit` step (the admin's chosen properties), or a `location` step (the geometry). Not a form page and not a `then` step. | — | Schritt |
| **Run** | One execution of a task by an actor. The only write operation. | command, mutation | (Übermittlung) |
| **Refusal** | The reason a run was not accepted, with a code from the registry. | — | Abgelehnt |
| **Rule** | The automatic execution of a task: an `auto` entry of that task (`tasks.<t>.auto.<name>`: one timing or an edge on its `when`, and a condition; an automatic run has no form, so the task's `then.set` supplies its values; docs/05, C-004). Identified by `<task>.<name>`. The system runs the task as a run by the actor `system`. | automation, sentry | Automatische Aktion (Regel) |
| **Relation** | A connection between features: a *reference* (picked) or *derived* (computed by a rule, e.g. `within`). | — | Beziehung |
| **Edge** | A stored relation instance (from, relation, to). | — | — |
| **View** | Filter, sort, properties and style. Drives map layers, lists, exports, the API and the sync scope. | — | Ansicht |
| **Layer / Style** | The *visual* presentation of a view on the map. Never a dataset. | MapLibre layer / Style Spec | Ebene |
| **Map background** | One of the project's background maps, from the `map` section: `kind` `base` (one active) or `overlay` (any number), drawn under the feature layers. Source types and presets come from the `MAP_SOURCE_TYPES` and `MAP_PRESETS` registries. | MapLibre source and layer | — |
| **Tool** | A UI plug-in (photo, draw, measure, search, chat …). **Nothing else is called a tool.** | — | Werkzeug |
| **Role** | A permission group within a project. | — | Rolle |
| **Participant** | A field user with a QR login. | — | Teilnehmer |
| **Actor** | Whoever performs a run: `participant`, `admin`, `system`, `import`. | O&M observer | — |
| **Port** | An interface through which core receives I/O (storage, clock, IDs, blobs). | hexagonal architecture | — |
| **Fold** | The pure function observation → state. The only definition of current state. | reducer / projection | — |
| **Plan** | The pure function run + facts → observations or a refusal. | mutator | — |
| **Config version** | A deployed, immutable compiled project config. Every run records the one it was planned against. | — | Version |

## Banned v3 terms (the lint fails)

| Don't write | Write instead |
|---|---|
| workflow instance, `workflow_instance`, `instance_id` | feature, `feature_id` |
| workflow (as a data type) | feature type |
| field def, `field_def`, `fieldDef` | property |
| field value, `field_values` | observation |
| case, cases (as a domain noun) | feature |
| submission | run |
| automation | rule |
| tool config, participant tool, `ToolStep` | view / tool / field (whichever is meant) |
| marker, marker category | feature, feature type (a marker is only a rendering) |
| instance links | edges |
| stage (as a built-in concept; any `select` as a process) | the stage property named by the type's `process` (config-declared, R4) |
| PocketBase, `pb.`, Goja, hook (for domain logic) | core, ports, server adapter |
