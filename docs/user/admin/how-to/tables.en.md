# Creating and maintaining tables

A **table** is a small list with no map and no process, for example equipment or streets. Forms can offer it as a choice. Technically a table is a feature type with no geometry and no process; each row is a feature.

## Where to find them

In the sidebar, group **Tables**. Clicking an entry opens that table's page. Clicking the heading **Tables** opens the overview of all tables. The arrow in front folds the group. The **+** of the group creates a new table (enter a name, **Create**); the new table's page opens and the yellow "Unpublished changes" bar appears.

## The overview

A table with one row per table: **Table name** (the fixed key), **Display name**, **Description**, **Main column** and **Visible to roles** (empty means "All"). As in every list: search, sorting, filters.

- **Edit tables inline:** switch it on in the toolbar, then clicks on display name, description and roles change the table directly.
- **Create table:** the last row is always there. Enter table name (lowercase letters, digits and underscores, starting with a letter), display name and main column, optionally description and roles, and confirm with the check. The new table has the one column you named as the main column.
- **Row menu (⋮):** **Edit** opens a dialog (display name, description, main column, roles; the table name stays because keys never change), **Edit structure** opens the table's page, **Delete** asks first and removes the table from the draft.

## The page of a table

**Header:** the name, the description and "Visible to roles" change in place (pencil, then check or Enter; Escape cancels). **Refresh** reads the rows again.

**Table:** one column per property, in the table's order. The **first column is the main column**; you decide which one it is by ordering the columns. A reference column (created in the builder) shows the name of the entry it points at (the column's display field), not its ID.

- **Add row:** the last row of the table is the entry row. Fill the cells (required columns first) and confirm with the check. A column with a default value is already filled. The server checks the values; a refused value shows as a message and your input stays.
- **Edit cells:** switch on **Edit mode**. A click on a cell opens it (a role column opens a choice of the project's roles); Enter takes the value into the row. The row's check saves all changed cells of the row together, the cross discards them (see *Viewing the data of a feature type*, section Correcting cells).
- **Delete a row:** row menu (⋮), **Delete**, confirm. The row leaves the table; it stays in the activity.
- **Manage columns:** the **+** in the last header opens "Manage columns". It lists all columns with type (Text, Number, Date, Yes/No), "Required" and default value. **Changing the order:** drag a column by the grip on its left to its place (a line shows where it will drop), or focus the grip and press Arrow up or Arrow down. On a phone every column has "Move up" and "Move down" buttons. The top column is the main column; every change is written to the draft at once.
  - **Add column:** column name, data type, default value, required. The new column goes to the bottom.
  - **Edit (pencil):** change name, type, default value and required; the internal key stays.
  - **Delete (bin):** asks first; the column's values go with the next publish.
  - **Order:** drag a column by its grip to its place, or focus the grip and press Arrow up or Arrow down; on a phone the buttons **Move up** and **Move down**. The top column carries the "Main" mark.
  - Columns of other types (for example choice) made in the builder show here and can be deleted and moved; you edit their type in the builder.

## Draft and publishing

Everything about the structure, so tables, names, descriptions, roles and columns, changes the **draft** and shows in the "Unpublished changes" bar. New columns are marked "new, goes live when published" in the list; **after publishing** they are in the table and editable. **Known limitation:** when only the order of the columns changes, the publish bar does not yet see that as a change; the new order goes live with the next other change (for example a new column). A table that was never published shows a hint instead of the rows; you can still define its columns.

Rows, on the other hand, apply **at once**: adding, editing and deleting are runs (admin creation, admin correction, lifecycle deleted) and show in the activity under your name.

## Import CSV

**Import CSV** (in the header of the table page, before "Refresh") loads rows from a CSV file into the table. It is the same wizard as on a feature type's data page: choose the file, map each CSV column to a column of the table (or **Skip**), check each row in the preview, then import. A table has no coordinate columns and no stage. Each row is created like a row you add by hand (one admin creation run) with the same checks: required columns need a value. Bad rows either refuse the whole import or are skipped, as you choose in the preview. **Replace all existing data (otherwise append)** works as for feature types; the old rows are then deleted.
