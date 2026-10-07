# Manage roles

The **Roles** page (sidebar, under the project) lists your project's roles. You add roles, rename and describe them, delete them, and choose who has a role. You do **not** set **permissions** here: they live in the workflow builder, on the field itself and in the permission matrix (see [Roles and permissions](roles-and-permissions.en.md)).

## The table

Columns: **Role name**, **Description**, **Self-join** (a switch) and **Assigned participants** (how many people have the role). Use the search at the top for a name or description; a click on a column title sorts. To change a name or description, switch on **Edit roles inline** and click into the cell (Enter saves, Esc cancels).

## Add a role

1. In the bottom row enter the **Role name** (at least 2 characters) and optionally a **Description**.
2. Confirm with the check (**Add row**).

The role goes into the project file's **draft** (the system makes the key from the name). It shows in the publish bar under the header and applies to everyone with the next **Publish**. Before the first publish nothing is live anyway.

## Row menu

⋮ per row:

- **Edit role**: a dialog with role name and description. The role's key stays the same, so nothing that names the role breaks.
- **Edit participants**: pick who has the role from a list. On a phone the picker opens as a full-screen dialog with search and **Done**. Type a new name and confirm to add a person; they are in the picker afterwards. **Save** applies all changes at once. Assigned people apply immediately, they are not part of the draft.
- **Show join URL & defaults**: opens the self-join dialog (see below). When the role's self-join is off, a message asks you to switch it on first.
- **Delete role**: asks first. The dialog names the people who have the role and the places in the project file that still name it (automatic actions, permissions, views); after the delete they report a problem and must be adjusted before you can publish. The role stays active until you publish.

## Self-join

The **Self-join** column has a switch per role. **On** creates the role's public link `/join/<slug>` at once; whoever opens it is added as a guest (named "Guest") with that role and lands on the role's home view (the map when it has none). **Off** blocks the link at once. Switching on again restores the same slug, so printed posters keep working. The switch is not part of the draft and needs no publish. Guests are deactivated after 90 days without activity and then no longer appear in the list (their work stays in the history). Activity is any use of the app, including sending changes.

In the row menu, **Show join URL & defaults** opens the **Self-join link** dialog:

- **Join URL**: the field selects on click; **Copy** puts the URL on the clipboard.
- **Max. entries per participant (0 = unlimited)** with **Save**: how many features a person with this role may create in total; deleting one frees a place. 0 removes the limit. The quota is part of the project configuration: **Save** writes it to the **draft**, the publish bar appears, and it applies after **Publish**. After that the server refuses creates over the quota.
- **Defaults applied on self-join**: name, role, email (guests have none; they sign in with an access key), active, lands on (the role's home view) and the automatic deletion.
