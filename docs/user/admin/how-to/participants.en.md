# Manage participants

The **Participants** page (sidebar, under the project) is the list of your field workers: you add people, give them roles and a login, switch someone off, and print QR badges. It works as in v3: one table, a quick add row and no sub-pages.

## The table

Columns: **Name**, **Email**, **Phone**, **Access token**, **Roles**, **Status** and your own fields. Use the search at the top; a click on a column title sorts, the filter button next to it lists the column's values. To change a name, email, phone, token, roles or your own fields, switch on **Edit participants** and click into the cell (Enter saves, Esc cancels). The **Status** switch always works: someone who is switched off cannot sign in; their work stays in the history, and you can switch them on again at any time.

Self-joined guests are hidden. Switch on **Show guests** to see them.

## Add a person

1. In the bottom row, enter the **Name** (required; the system generates the id).
2. Optionally set email, phone and **Roles**. In the roles field you can type a new name and press Enter to create a new role.
3. Confirm with the check mark (**Add row**). The person gets an access token at once.

Custom fields that you made required must be filled in, otherwise the row is not added.

## Roles

An existing role applies at once. A **newly typed role** is written to the draft of the project file (participants themselves are not part of the draft): it can be chosen in the list immediately, and becomes active for everyone with the next **Publish**. In the row menu (⋮), **Edit roles** opens the same picker in a dialog.

## Access

The **Access token** column shows the person's readable token. The copy button puts the **login link** (`…/login?token=…`) on the clipboard, to send by messenger. In the row menu: **Generate a new token** replaces the token, **Revoke login** blocks the token and signs the person out on every device. In edit mode you can enter a token of your own.

## Print QR badges

Tick rows (header: all; Shift+click: a range). **Export QR (n)** appears. You get an A4 PDF with 8 badges per page (2 × 4): QR code and name. The code holds the login link, so a phone camera opens it too. If someone has no token, one is generated for them.

## Custom fields

The **+** in the last column header opens **Custom fields**: field name, field type (Text, Number, Yes/No, Date), default value (optional) and required field. You can add, edit and delete fields; deleting keeps the values already stored with the people. The order of the fields is the order of the columns: drag a field by its grip to its place, or focus the grip and press Arrow up or Arrow down; on a phone there are "Move up" and "Move down" buttons.

## Row menu

⋮ per row: **Edit** (name, email, phone), **Edit roles**, **Generate a new token**, **Revoke login** and **Delete**. Delete hides the person and blocks their login; their work stays visible in the history.
