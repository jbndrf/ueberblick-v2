# Personal data in your project

Some properties hold data about a person, for example the reporter of a defect or a person named on a feature. Mark them in the project file so Überblick knows what to blank or export when someone asks for erasure or access.

```yaml
melder: { type: participant, personal: { subject: actor } }
```

`subject` says whose data it is:

- `actor`: the participant who submitted the change (for example the reporter or a live position)
- `property:<key>`: the participant named in another participant property of the same feature type, for example `property:zustaendig`
- `feature`: the feature itself is about a person

The builder warns you when a personal property

- has `index: true` (an index keeps the value searchable; remove it), or
- is shown to every role by a view. Restrict it with `permissions.see`, for example `see: { melder: [sachbearbeiter] }`.

The access export is [Exporting a person's data](../how-to/export-person-data.en.md); the marking is the basis for it.

## Erasing a person's data

An erasure is an ordinary run of an admin task: it blanks the person's values on the features and cannot be undone. You write it as a task with a `redact` step, for example `then: [{ redact: { subject: actor, of: form.subject } }]` with a form field `subject` for the person's id (the maengelmelder template has an `erase_subject` task). `subject` names which values go (the same kinds as `personal.subject`); `of` says whose. It works like this:

- The person's personal values are replaced by empty values. The old values in the history are overwritten as well, and so is the copy of the values inside the runs that submitted them. Non-personal values, the feature itself and who did what when stay.
- The copy of the submitted values inside a run is blanked as a whole. If that run also submitted non-personal values, their copy in the run record is lost as well; the values on the features stay.
- Devices learn about it on their next sync and drop the old values. A device that never syncs again keeps its copy until it is wiped.
- Files (photos) that nothing refers to any more are deleted, but only after the erasure is saved. If the server stops in between, it finishes deleting the files when it starts again.
- The person's id is kept in a list of erased persons, without a name. If you restore a backup, the erasure is repeated for everyone on that list, so erased data does not come back.
- Backups made before the erasure still hold the old values until they expire. Keep the backup retention short (`docs/process/backup.md`).
- Erasing twice does nothing more. A value the person's device submitted later, from an old draft, is stored as a new value: an erasure is a point in time.
