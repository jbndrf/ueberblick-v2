# Erasing a person's data

When someone asks for their data to be erased (GDPR Art. 17), you erase their personal values. Erasing cannot be undone. Export the data first (see *Exporting a person's data*) if you have to hand it to the person.

Erasing is an ordinary run of a task with a `redact` step, for example `erase_subject` in the maengelmelder template (see the concept page on personal data). There is no separate erasure endpoint. You run the task like any other run, with `POST /api/p/<project>/runs`, and fill in the person's ID as `subject`:

```json
{ "id": "<new run ID>", "task": "erase_subject", "configVersion": 1, "input": { "subject": "<participant ID or feature ID>" } }
```

- Who may run the task comes from the project file: the task's `when` rule names the roles (in the golden template case handlers and administrators). Anyone else is refused, and nothing is erased.
- A confirmation step, if you want one, belongs to the task's form: add a confirm field with a `when` rule to your task.
- The task decides which values go: its `redact` step names the kind of subject, and the properties marked `personal` in the project file are the ones erased. System properties (`$type`, `$lifecycle`) cannot be erased.

If your project has properties marked `personal` but no task with a `redact` step, the builder shows the warning `personal_without_redact`. It means the project cannot answer an erasure request yet. To fix it, add a task with a `redact` step, as described above. It is only a warning, so you can keep working on the project meanwhile.

## What is erased

- The values read as empty in the current state afterwards, and the earlier versions and the inputs of the changes that recorded them are overwritten.
- Attachments (photos, files) that no value uses any more are deleted right after the answer. If the server stops in between, it finishes the job at its next start.
- The erasure itself stays in the log as a change, with the person's ID but without their values.

## Good to know

- This does not cover disk copies and backups: deleted files are removed, not overwritten on the disk. Plan for an encrypted disk and a backup retention period (see *Backups*).
- The person's chat messages are deleted. Where the person or an erased object is mentioned in other messages, the message stays and the mention is replaced by `[removed]`. The server sends the changed messages to the devices again, so copies are replaced the next time a device loads the chat.
