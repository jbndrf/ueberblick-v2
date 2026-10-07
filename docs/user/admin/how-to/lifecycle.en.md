# Entry status: active, completed, archived, deleted

Every entry (feature) has a system status, its lifecycle: **active**, **completed**, **archived** or **deleted**. A new entry is active.

- Only a change (a run) sets the status. In a task or an automatic action, add the step Set lifecycle (`lifecycle: <state>` in the project file) and choose the state. Nothing else, and no screen, changes it directly.
- **Completed** entries are still on the devices and can still be worked on. A later change can set them back to active.
- **Archived** and **deleted** entries disappear from the devices at the next sync, and every further change to them is refused with the reason `case_closed`. You still see them in the admin views.
- Setting **deleted** needs the delete permission (`permissions.delete`) of the entry's type. Without it the change is refused as `not_permitted`.
- Rules can set the status too, for example: completed for two years, then archive.
