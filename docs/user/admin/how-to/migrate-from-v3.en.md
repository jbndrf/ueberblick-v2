# Take over a v3 project

You have a project in Überblick v3 and want to continue it in v4. The configuration is converted automatically. You take over the data (features, inputs, history) in a separate step, see *Take over the data*.

## What you get
- **A template** with everything that makes up the project: roles, feature types, tasks, automatic actions and views. It is created as version 1.0.0.
- **Adjustments** (an overlay) that build on this template. They hold what belongs to your project, for example the map position. Later template versions can be adopted this way without losing your adjustments.
- **A report.** It says what became of **every** element of the v3 project.

## The report
Each element appears with its v3 path (for example `workflows.baum.tasks.kontrolle`) and has one of three statuses:

| Status | Meaning | What you do |
|---|---|---|
| mapped | exists in v4 with the same meaning | nothing |
| approximated | converted, but v4 expresses it differently; the reason is given | read the reason, check that the result fits |
| dropped | does not exist in v4 (yet); the reason is given | decide whether you need another solution |

The report is complete: no element is missing.

## What v3 becomes
- A **workflow** becomes a **feature type**. The stage becomes a select property `stage`, the geometry a property `geom`.
- **Fields** become **properties**. Each option of a choice field gets a fixed key; the label stays visible.
- **Custom tables** become feature types without geometry. Fields that choose from them reference them.
- **Tasks** (buttons) become tasks. The conditions of a task become one condition that holds while it is true. **A condition that cannot be converted counts as not met.** The task is then unavailable until you complete the condition by hand. Nobody gains rights through the conversion.
- **Automations and automatic tasks** become **automatic actions**, each with a system task.
- **Private cases** become a *Created by* property with a row filter: participants see only their own features.
- **Roles** get an app with a home view and the views they may see.
- The **map position** goes into the adjustments.

## How some v3 parts are converted
- **Computed fields.** The roles of the task that computes the field may write it; nobody else. A computed field that no task sets is written by rules only.
- **Text search.** *contains* ignores upper and lower case, as in v3.
- **Fields with several related instances.** They become a relation with many entries on the owner; each related feature points back at its owner.
- **Personal data.** E-mail fields, and text fields and participant selectors whose key or label contains a whole word that names a person or a way to reach one (for example *melder*, *telefon*, *kontakt*, *adresse*; *mobilitaet* does not count), are marked as personal data of the person who entered them. `convert` lists each one with its reason; check the list and correct it in the template. A selector such as *zustaendig* (the handler) is not marked: it is not personal data of the person who assigned it. When there is any, the template also gets the task *Erase a person* (`erase_subject`), which only admins may run, and a type *Erasure* for its runs. Without it nobody could erase a person (see *Erasing a person's data*).

## What does not come along
Basemaps and overlays, info pages, consent texts, saved filter presets, quotas per role, time rules *after n days in a stage*, protocol entries (snapshots) and formula functions such as `round` or `min`. The report gives the reason for each. You set up basemaps in the app.

## Check the behaviour (differential check)
The report says what was converted. The differential check shows whether the project still **behaves the same**: recorded v3 runs (who ran which task on which feature, accepted or refused, with what result) are replayed in the converted project. Every difference goes into a list with its reason.

| Cause | Meaning |
|---|---|
| reported | an `approximated` or `dropped` report entry explains it; its id is listed |
| known | someone noted the difference beforehand, with a reason |
| not convertible | the run names something that v4 does not have (task, field, option, value) |
| unexplained | nothing explains it: a converter bug or a wrong recording. Resolve it before the cutover. |

With real runs the check is possible once you supply an export of the v3 task runs. Until then it is tried on synthetic runs. The format of runs and report: `apps/migrate/README.md`.

## Take over the data
The data conversion turns every v3 case into a feature and replays its history as import runs, in the order in which v3 recorded it. Each value keeps the time at which it was observed (`phenomenon_time`), including inputs that a device recorded offline and delivered later. Nothing is written past the run rules: the runs have the actor kind `import` and go through the same checks as any other run.

1. **Convert the configuration first** (above). The data conversion needs its result.
2. **Prepare the import project.** It is the converted project plus two tasks per feature type that only the import may use (`<type>_import`, `<type>_import_update`), and **without automatic actions** (`auto` entries): v3 automations already ran when the history was recorded, and they must not run again.
3. **Run the data conversion.** It works in batches. Each batch is atomic. If it is interrupted, you continue from the last stored checkpoint; runs that the server already has are not written twice.
4. **Deploy the full project** as the next version.

What happens to the data:
- **Position.** The v3 centroid is not carried over. v4 derives the anchor of every feature from its geometry, so a polygon's marker lies on the area. The height (Z) of a position is kept.
- **Text** is stored normalised (NFC), so `ä` is always the same character.
- **References** are written last, once every feature exists, with the time at which v3 wrote them. A relation with many entries is written on the related features; when v3 shortened the list, the removed features are cleared. A selector on a custom table finds its row by id or by the value of one of its columns, if that value is unique.
- **Permissions.** The conversion gives nobody more rights than v3 did: the import tasks are offered to the import only, and read-only fields of v3 stay read-only for participants.

**The data report** lists each record that could not be carried over completely, with its v3 id and the reason: an instance without position (v4 features need one), a workflow or field that the converted project does not have, an option or status without a counterpart, a reference to a record that was not converted, files (the export has no file bytes), and runs that the server refused. Everything else is written.

The format of the export, the calls and the speed (60,000 features in well under 10 minutes): `apps/migrate/README.md`. Until you supply an export of the real v3 data, the conversion is tried on synthetic data.

## The path to the cutover
The whole migration is described as a runbook: `docs/process/cutover-runbook.md`. In short:

1. **Export.** From the running v3 project: the project definition, the data and recorded task runs. *This needs access to your real v3 and is done by you.*
2. **Convert:** `migrate convert v3-project.yaml --out folder` writes the template, the overlay and the report.
3. **Differential check:** `migrate diffcheck v3-project.yaml v3-runs.yaml`. Exit 0 means no unexplained difference.
4. **Carry the data into a copy:** `migrate import v3-project.yaml v3-data.yaml --dir folder`.
5. **Pilot on the copy.** *Done by you:* your people work in v4 for at least a week while v3 stays the system of record.
6. **Sign-off.** The report, the differential check and the data report are reviewed, the pilot has no open serious findings and the backup is tested.
7. **Cutover.** *Done by you:* v3 is frozen (read-only), the migration is repeated with the final export, v4 is opened to users.
8. **Rollback.** Before anyone works in v4, simply unfreeze v3. After that, work done in v4 does not flow back to v3; decide on the first working day whether to carry on in v4. Keep v3 unchanged for at least 30 days.

**Try it first:** `migrate dry-run` runs the whole chain on a sample project, so you see that the tool works before you touch real data. All commands are called as `npm run migrate -w @ueberblick/migrate -- <command>` (shortened to `migrate` here).

## Afterwards
1. Go through the report, first the `dropped` entries, then the `approximated` ones.
2. Open the result in the builder. It contains no errors (it is checked during the conversion); hints, for example about options that no task sets, are normal.
3. Take over the data only when you are satisfied, then go through the data report.
