# Deploy a project

Deploying checks the project file and makes it the valid configuration version. The **Versions** page shows the results (see below).

1. **Preview.** You see what changes against the running version: added, removed and changed entries with their path. Changes that affect data (removed types, properties, options, roles; changed property types) are marked breaking. A changed order is a change that names its owner (the Objektart, task or property with its name, then which order) and never breaking. For an Objektart whose only change is an order, the preview does not ask keep or move: an order touches no Objekt.
2. **Check.** If there are errors (unknown keys, wrong expressions, violations of template locks), nothing is deployed. Every error names the path and a suggested fix.
3. **Deploy.** A new, immutable version is stored. The previous one is retired but stays readable: submissions still queued on a device are validated against the version they were made with.

- Deploying the same file twice creates no new version. A changed order alone is a change: deploying it creates a new version. Deploying an older file again makes its version active again.
- Properties with `index: true` get a database index on deploy; when the setting is removed, the index is dropped. Nothing else ever changes the database.

## Running objects: keep or move
When an object type changed and it has **running** objects (state *active*), the deploy asks once per object type (as v3 did per workflow):

- **Keep running objects on the old version** (`keep`). Every running object of that type is pinned to the version that runs now. It keeps that version's tasks, forms and stages until it is moved by hand (**Move to current version** on the Versions page) or finished. The pinning happens inside the deploy itself: one system run per object, all or nothing.
- **Move running objects to the new version** (`move`, the default). The objects continue on the new version, and the deploy's value moves apply to them.

*Completed* and *archived* objects are never pinned: they always move along. New objects always get the newest version. Objects that are already pinned stay on their version either way, and value moves never touch them.

The dry run (`POST /api/admin/p/<project>/plan`) gives three numbers per changed object type that has running objects: `running_floating` (running, not pinned: what `keep` would pin), `already_pinned` and `settled_floating` (completed or archived, not pinned: they always move along). The `affected` number on a breaking entry counts all unpinned objects, whatever the choice. The choice goes in the `versions` parameter: `POST …/deploy?versions={"baum":"keep"}`; types not named get `move`. A choice for an unknown type, a type this deploy does not change, or a type with no running objects is refused with a problem at the path `versions.<type>`. A first deploy has no choice.

## The deploy overview ("Publish")
**Publish** in the yellow bar (every project page) and in the builder's toolbar opens the same overview. It shows what publishing does before anything happens:

- **One card per Objektart** with a badge (**new**, **Breaking change - n removed** or **No breaking changes**), the number of objects and the changes in words (for example: Stage Maßnahme removed, Property Vitality added). Several changes to one task or property show as one line. On the first publish every Objektart just shows as **new**.
- **Running objects.** If a changed Objektart has running objects, choose **Leave running objects on their current version (legacy)** or **Move running objects to the new version** (the default). Below are the three numbers of the dry run: running, already on an older version, completed or archived (these always move). Without running objects the choice does not appear.
- **move to.** If removed stages, options or properties still hold values, a row shows the number of objects and a select: **move to <target>** or **Discard values**. **Publish** stays off until every row has an answer. Rows whose values no object holds any more (or only running ones that you keep) need no answer and discard nothing.
- **Fix first:** the draft's problems with **Go to**, which opens the builder at that element. While there are any, **Publish** stays off.
- **Notes** (for example a schedule that never runs) block nothing.
- **Preview logins.** Under the changes there is one link per role of the draft, plus **No role**. **Copy link** puts it on the clipboard (it then says **Copied!**). Whoever opens the link on a phone is signed in to the preview as that role: you see the draft with demo data and change nothing real. A new role gets a link with the next save, and a removed role's link stops working. The links stay valid when you publish, and the preview's Objekte (demo data and what testers entered) are kept: they move with the same mappings as the real Objekte. **Reset demo data** (it asks first) generates new demo data and drops the test data; the links stay, but the phone has to sign in again. **Before the first publish:** the same links are also under Project settings, **Status & Release**; a project made from a template has them at once, with nothing live.

After **Publish** a progress shows, then "Version n is live." appears as a message and in the bar. If the draft changed in the meantime, the overview reloads. On a phone the overview is a scrollable dialog and the selects are the device's own.

## The Versions page
Open **Versions** in a project's sidebar (`/admin/projects/<project>/versions`). The page looks like v3's Releases list: one row per version, newest first, with `v<number>`, the status (**active** for the running version, **replaced** for older ones), the number of object types, the template and the date. With no versions it shows a note that there are none yet.

- **Roll back.** Every replaced version has a **Roll back** button. A dialog asks once; then that version's file is deployed again, with the same checks as any deploy. The older version is **active** again; the list keeps every version. If the rollback would affect data that needs a mapping, the page says so and does nothing.
- **Compare.** Tick two versions and press **Compare**: below the list you see every added, removed and changed entry with its path and every changed order ("order changed"), grouped by place, and which changes are **breaking**.
- **Update the template.** When a newer version of the template your project extends is published, an offer ("Template <name>: version <x> available") appears above the list. It shows how many changes apply on their own and, for every key both you and the template changed, your value next to the old and the new template value: **Keep my value** or **Take the new template's value**. Entries the new template removed can be removed or kept (and fixed by hand). When every conflict has a choice you see the changes and, for breaking ones, a mapping ("Discard values" or "Move to <key>"); **Update and publish** deploys the result. The draft then starts again on the new template.
- **Move to current version.** When a deploy left objects on an older version with *keep*, that version's row shows **<n> objects still on this version** and the button **Move to current version** (only while objects are still there). The dialog says how many objects switch from which version to which, and, as in a deploy, asks for every breaking change that touches the values of those objects: **move to <target>** or **Discard values**. **Move** stays off until every row has an answer. Every object of that version switches, completed and archived ones too. Each switch is a system run in the object's history, all or nothing: if any run is refused, everything stays as it was. Afterwards the count is gone, and devices load the objects under the deployed version. There is no automatic move when an object is completed.
- **Discard draft.** At the top right, **Discard draft** asks once and then throws away every change in the builder that is not live yet. The draft equals the active version again.

The page works on a phone: rows wrap, and the mapping choice is the device's own picker.

Not on this page: **Publish** (see above, the deploy overview) and **Publish as template** (comes to the project menu). Until then: `npm run admin -- publish-template`. For assistants and scripts: `GET /builder-api/<project>/plan?versions={...}` (the dry run of the draft) and `POST /builder-api/<project>/deploy` with `{ revision, mappings, versions }`. Deploying is always your click: the builder and assistants only prepare.
