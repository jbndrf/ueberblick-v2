# Viewing the data of a feature type

In the sidebar, click a feature type under "Feature types". The page shows all features of that type in a table, even with tens of thousands. (Tables have a page of their own, see *Creating and maintaining tables*.)

**Header:** the name of the feature type; on the right "Import CSV", "Icons" (the icon designer, see [Icons and colours](icons.en.md)), "Builder" (opens this type's builder), "Refresh" (reads the rows and the participants' names again) and the ⋮ menu (see *Duplicate, import, delete*).

- **Change name and description:** click the name or the description, type, and confirm with Enter or the check mark. Escape or the cross cancels. An empty name is refused.
- **Visible to roles:** click the roles under the description and choose which roles see the type. With nothing chosen, every role sees it ("All"). If visibility is set per property, a note says so; change it in the builder under Permissions.
- **Incident or survey, point, line, area:** the first pill says whether the type sits on the map (incident) or is a plain form (survey); the second, which shape participants draw. Click a pill to switch. If the type already has features, a note says the change takes effect on publish, and the overview there shows the affected features, which you can discard or keep.
- **Private entries:** when the switch is on, participants see only the entries they created themselves. If a custom visibility condition applies (Code view), the switch is locked and the condition is shown below it.

Every change goes to the draft; the "Unpublished changes" bar appears, and only "Publish" makes it live for everyone.

**Columns:**

| Column | Content |
|---|---|
| Status | the lifecycle: active, completed, archived, deleted |
| Stage | the stage in the type's process (only if it has one) |
| Created by | the person's name; an admin shows with their e-mail address, an import as "Import (admin's e-mail)", automatic actions and timers as "System"; if the person is no longer on the roster, their id is shown |
| Location | the coordinates (types with a geometry only); hovering or tapping shows the shape |
| one per property | in the order of the feature type; files show thumbnails (a click enlarges) |
| Created | date and time |

Deleted features are hidden at first. Pick **deleted** in the filter of the Status column to see them.

A field whose source is **Roles** shows the role name in the table (the key when the role was deleted).

**Search, sort and filter** work as in every list (see *Work a list*). The server answers every request; a column's filter lists the values of all features with counts, not only of the loaded rows. Search finds partial text in text, choice and number values and in the creator's id. Multiselect, file, multilingual text and Location columns cannot be sorted; file, multilingual text, Location and Created columns cannot be filtered.

**Paging:** there are no page numbers. 200 more rows load when you scroll to the end; a spinner shows the loading.

**Not published yet:** a feature type that exists only in the draft has no features yet; the page says so.

**Open an object:** a click on a row opens that object's page (see *Look at one object*). "Back to objects" returns to the table with the same search, sort and filters.

**Correct cells (edit mode):** Turn on "Edit mode" in the toolbar. A click on a cell opens it; Enter takes the value into the row but saves nothing yet. The row gets a check and a cross at its end (column "Actions"). The **check** saves all changed values of that row **together as one run**, the task "Admin correction"; afterwards it is in the object's activity with your name and the values. The **cross** discards the row's changes; turning edit mode off discards all unsaved ones. If the server refuses a value (for example a wrong type), the cell shows a red frame with the reason; the other changes of the row stay for correction. If somebody changed the object in the meantime, nothing is saved; refresh the page and edit the row again. Rules and computed values react as to any change.

The **stage** cannot be edited (a hint shows on hover): it changes through tasks, so their automatic actions run. Cells for people, references, multilingual text and files cannot be edited yet.

## Duplicate, import, delete (⋮)

At the far right of the header is the **⋮ button ("More actions")** with three entries. All of them change the draft only; "Publish" makes them live for everyone.

- **Duplicate:** copies the feature type with its tasks, automatic actions and views into the draft as "<Name> (copy)" and opens the copy. Tasks that create objects of another feature type are not copied; the message names them. <!-- ui-strings-ignore -->
- **Import from project:** pick another project of yours (with a published version) and one of its feature types. The feature type lands in the draft as a copy. Relations and references to feature types this project does not have are left out, and permissions for roles this project does not have are dropped; both are listed in a message. Check the permissions in the builder afterwards.
- **Delete feature type:** a dialog names what goes with it (stages, tasks, automatic actions, views, objects and recorded values). If there are objects, you must type their number before "Delete" turns on. The feature type leaves the draft; **it is deleted for good only with "Publish"**. The overview there shows the affected objects, and you decide whether to discard them. Afterwards the project settings open. If something still points at the feature type (for example a relation of another type), the dialog reports it as a note; fix it in the builder, or publishing is blocked.

## Import CSV

At the right of the header is **"Import CSV"** (as in v3). It opens a wizard with four steps:

1. **Upload:** pick the CSV file. The first row holds the column headings; semicolon, comma and tab are detected.
2. **Map:** each CSV column gets a property of the feature type (or "Skip"). Required fields are marked * and must be mapped; columns whose heading equals a property are pre-filled. A feature type with a point has the columns "Longitude (lon)" and "Latitude (lat)" and a coordinate system. **"Import into stage"** creates all features in the chosen stage. Under **"Value for all rows"** other properties get the same value in every row, a role too (pick one of the project roles).
3. **Preview:** the server checks the file and writes nothing: the number of ready rows, the first rows as they would be stored, and the problems with their row number. The task's rules and permissions are only checked by the import; they can refuse more rows. You choose between "All or nothing: one faulty row refuses the whole file" and "Skip faulty rows and import the rest". Replacing all existing data deletes every feature of the type first and is always all or nothing: if anything is refused, the old data stays.
4. **Progress:** a bar shows "n of m imported", then the result. "Go to the features" closes the wizard; the table is up to date. An import with all or nothing is written at once, so the bar jumps at the end.

**Not published yet:** the import runs on the published version. If the feature type is not published, step 3 says so and the last button reads **"Publish and import"**: the draft is published first, then the file is imported. There is no checked preview then; the import shows problems of single rows afterwards. If publishing needs a value move, the wizard sends you to the builder first and imports nothing.

Files: the wizard takes CSV only; GeoJSON becomes a new feature type through the sidebar's "Import GeoJSON" wizard, GeoPackage goes through the API (see *Import and export data*).
