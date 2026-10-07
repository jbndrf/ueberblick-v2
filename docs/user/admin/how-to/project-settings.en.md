# Project settings

The **Project settings** page (sidebar, under the project) collects what applies to the whole project. On the left is a list of **sections**, on the right the selected one. On a phone the list sits above the section. The selected section is in the address (`?section=…`), so a link or a reload goes back to the same section. Only sections that exist are listed; more follow over time.

Every change here goes into the project file's **draft**. The publish bar shows **Unpublished changes**; the change is live with the next **Publish**.

## General: App branding

Here you decide how participants see the project in their app.

- **App name**: the name in the app's header. Leave it empty to use the project name (it is the field's placeholder). **Save** keeps the name.
- **Upload icon**: an image (PNG, JPG, SVG or WebP, at most 2 MB). After you choose a file the preview shows it; **Upload icon** saves it. If the file is not an allowed type or is too large, a message says why and nothing changes.
- **Remove icon**: shown while an icon is set.

Participants see the name and the icon after you **Publish**.

## General: Template

Here you see which template the project builds on and adjust the inputs the template's author offers for customising it (for example a district name or an inspection interval).

- **Template** and **Version**: the template's name and version number, read only.
- **Template inputs**: one field per input, matching its type (number, text, date, switch, choice, multiple choice, multilingual text with one field per language, German and English), with the template's label and hint. A field that shows the template's value means you have not changed it. **Save** writes only changed values into the draft; setting a value back to the template's own removes your entry again. The bar "Unpublished changes" then appears; publishing works like any other change.
- If the template offers no inputs, you only see the template and its version.
- The bundled templates (tree cadastre, defect reports, events) explain every input in one sentence: what it does and which automatic action or task it drives.
- Inputs of other types (for example geometry) are only shown; a note says they cannot be edited here.

## Map: Map layers

Here you decide which background maps exist: **Base** maps (one is active at a time) and **Overlay**s (any number on top). The line under the heading names the base layers, or says there is none yet.

- **Add layer** opens the dialog "Add map layer" with the tabs **Presets**, **Tile URL**, **WMS**, **Upload**, **PMTiles** and **GeoJSON**. A preset is one tap: the first one becomes the base, every later one an overlay; ones already there show **Added**. The other tabs (except **Upload**, below) ask for **Name**, the address (for **Tile URL** with the placeholders z, x and y; **PMTiles** also as a path on this server), **Attribution (optional)** and the switch **Set as base layer**. A wrong entry gets its message in the dialog.
- **Upload** brings your own tiles to the server: **Name**, **Tile format** (PNG, JPG or WEBP, only for a ZIP; MBTiles and PMTiles name their format themselves) and **Tile file** (a ZIP of tiles as z/x/y.ext, MBTiles or PMTiles). **Upload tiles** sends the file in parts with a progress bar ("Uploading..."); if a connection drops, it continues where the server stopped. Then the bar shows "Processing..." while the server turns the file into one PMTiles archive. When it is done, the layer enters the draft as an overlay and the dialog closes. A refused file names the reason (too large, too many tiles, ZIP inflates too far, no tiles, damaged, wrong format ...). A vector archive goes to the **PMTiles** tab, where you enter the source layer. Limits: 2 GB per file, 3 open uploads per project.
- The table shows **Layer name**, **Type**, **Opacity**, **Visible to roles**, **Base**, **On at start**, **Order** (drawn bottom first) and **Fetched**: **Via the server** means the participants' map loads the tiles through this server's tile proxy (see Tile proxy), **Direct** does not. With **Edit mode** you change name, opacity, roles and **On at start** in the row. With no roles every role sees the layer.
- The row menu offers **Edit** (all settings: address, attribution, opacity, zoom range, roles, default base map), **Set as base** / **Set as overlay**, **Move up**, **Move down** and **Delete** (asks first). A layer that an offline pack holds can be deleted only once it is out of the pack. Deleting an uploaded layer also removes its tile file; while the published map or a pack still uses it, the file stays and a message names who.

Everything goes into the draft; participants see the change after you **Publish**.

## Map: Default view

Here you decide where the map opens for participants and how far they may zoom.

- **Default zoom** and **Center latitude** / **longitude**: the start view of the map.
- **Min. zoom** and **Max. zoom**: the limits of zooming (whole numbers from 0 to 24).

Until you save something the fields show suggestions (zoom 10, zoom 1 to 19, the middle of Germany). The box above the form sums up the saved view. A value that fails gets a message under its field: latitude only from -90 to 90, longitude from -180 to 180, zoom from 0 to 24, and **Min. zoom** ≤ **Default zoom** ≤ **Max. zoom**. **Save defaults** writes the values into the draft. The participant map applies min. and max. zoom.

## General: Status & release

Shows where the project stands and puts it live. The box at the top names the state: **Draft — not published yet** (participants see nothing yet), **Version n is live — unpublished changes** or **Live — version n**. Below it, each Objektart shows how many objects exist. What keeps the draft from being published (blockers) is a red line under the Objektart, with a link **Open in builder**; blockers that belong to no Objektart are listed under **Project**. While there are blockers the button is disabled. **Go live** (the first time) or **Publish** opens the overview of the changes, where the draft goes live as a new version. It is the same step as the button in the publish bar. When everything is live, **View versions** leads to the version list.

## General: First-run defaults

Here you decide what participants see when they open the map for the **first time**. The choice applies while the person has not chosen anything there themselves: once someone chooses layers or switches something in the **Filter**, that choice is kept – even if you change the first-run defaults later.

- **Base layer**: the background map at start. **(first base layer)** takes the first one in the map's list.
- **Overlay layers (on at start)**: which overlays are switched on at start.
- **Save startup defaults** writes the choice into the draft (the `on_at_start` field of each layer).

The layers themselves come from the project file (`map.layers`). Without overlays the page says "No overlay layers available."
- **Visible object types**: which object types are visible on the map at start. **All** is on while every object type is on; the checkboxes are then disabled. Switch **All** off to untick single object types. The arrow before an object type (only when it has stages or values) opens **Stages visible at start** or **Values visible at start**: there you untick single stages (or the values of its classification). Without object types the page says "No object types." Only object types with a place on the map are listed.
- Saved on the type as `on_at_start: false` (off) and `values_at_start` (the values that are on; absent means all).

## Features: Project chat

Here you switch on the project-wide chat for participants.

- **Enable project chat**: the switch. Off, the chat is hidden from everyone. On, the chat belongs to the project.
- **Roles allowed in chat** (only while the chat is on): pick roles to limit the chat to them. **Empty = everyone in the project**: with no selection every role has the chat. Another tool of a role never changes because of this.
- **Save** writes the draft.

Switching off removes the chat and the roles' entries for it from the draft; it publishes like any change. If you switch the chat on again, the roles that get it by the role rule have it; earlier per-role restrictions are not kept.

## Features: Info pages

Help and legal texts participants read in the app under Profile.

- **Add info page** opens the form: **Title**, **Content** (HTML; links, paragraphs, bold, italic, lists and headings are allowed, anything else is removed when shown) and **Sort order** (0 or more; smaller numbers come first).
- In the content the app replaces the **variables** `$token` (access token), `$loginlink` (login link), `$qrtoken` and `$qrloginlink` (each as a QR code) for each person. The form lists them.
- The list shows each page with its title, two lines of text without HTML and the sort order. The pencil edits, the trash can deletes: a second click on the red **Delete** confirms.
- Pages that the template ships are listed too; editing and deleting them applies to this project only.

The changes are in the draft; participants see them after you **Publish**.

## Features: Offline packs

Tile packs of a region that participants download to work without a network.

- **Create pack** (disabled while the project has no map layer): **Pack name**, **Min zoom** and **Max zoom** (0 to 22), **Region**, the map layers (every layer that can be packed is preselected; one that cannot be packed, such as WMS, is greyed out) and **Visible to roles** (empty: all roles).
- **Draw region on map** opens the map. **Rectangle**: tap two opposite corners. **Polygon**: tap vertices and close with **Done**; the rectangle around the vertices is saved, because a pack is a rectangle. At the top you see the area and the estimated tile count for the chosen zoom levels. **Clear** resets the choice, **Confirm** takes it.
- A pack above the limit (250,000 tiles or 1 GB) is not created; the message says what to do.
- The table shows **Name**, **Status**, **Zoom**, **Tiles**, **Size** and **Visible to roles** (editable in place in **Edit mode**). The row has a menu with **Delete**.
- **Status**: **Draft** (not published yet, or changed since it was built), **Queued**, **Building** (with progress), **Ready** (with the real tile count and size) or **Failed** (with the reason and **Rebuild**). The build starts with **Publish**; the table asks again every 3 seconds.

Packs are in the draft under `map.packs` (see the API reference for offline packs).

## Features: Filters & fields

Here you decide whether participants can filter the map by property values, and prepare ready-made filters.

- **Enabled at startup**: the switch **All roles** turns the "Views" tool (the tab with the filter builder in the filter sheet) on or off at start for every role. Under **Per role** each role has its own switch. "On at start" means the person sees the tool right away; "Offered, off at start" means they can switch it on in their preferences. A role that does not have the tool shows **Not offered**; switching it on offers it.
- **Filter presets**: ready-made filters that participants of a role pick with one tap in the filter sheet under "From the project". **New** opens the dialog: **Name**, **Applies to roles** (all roles at first) and **Filter conditions** with the same filter builder as in the app; the builder offers the fields the chosen roles may read. The list shows the number of conditions and the roles of each preset. The pencil edits a preset, the bin deletes it for all its roles after a confirmation.

If the draft still has problems (see the problem list in the builder), the list shows a note, and the filter builder is available again once they are fixed.

## Features: Clustering

The map always groups nearby features into clusters at low zoom levels; as in v3, features within 80 px of each other group, and above the project's **Max. zoom** (19 when none is set) every feature shows singly. The **Cluster** tool dissolves the groups and shows single features. **Enabled at startup** turns it on at start for all roles (or per role); without the switch it is offered and the person switches it on in their preferences.

## Integrations: GIS access

Here you issue access tokens for QGIS and other GIS programs. A token belongs to a **participant** and gives QGIS the same permissions as that participant (the feature types and properties their roles may see). Or it belongs to you as **admin** and has your admin permissions, in this project only.

- **Create token**: under **Access as** choose *Participant* (then pick the participant) or *Admin (my permissions)*, enter a **Token label** (for example My laptop QGIS), optionally **Expires**, then **Create token**. The full token is shown **only this once** with **Copy**; only a fingerprint is stored. It starts with `ubk_`.
- **Table**: label (with the last four characters), participant (or "Admin: <email>"), created, last used, expires. **Revoke** asks first and blocks the token at once; QGIS connections that use it stop working. When a participant is blocked, their tokens end too; so do the admin tokens of a blocked or deleted admin account.
- **Connect QGIS**: the connection URL is in the section (`https://<server>/api/p/<project>/ogc`). In QGIS choose `Basic` under Authentication, enter the token as the user name and leave the password empty (see [Connect QGIS](connect-qgis.en.md)).

A token is not a login: it does not open the app. A participant token reads **and writes**, with exactly that participant's permissions: QGIS may create or change only what the participant may do in the app (see [Connect QGIS](connect-qgis.en.md)).

## Danger zone: Delete project

**Delete project** permanently removes the project and everything that belongs to it: features and their history, participants, files, offline packs, the preview, logins and tokens. The dialog first says what goes (feature types, roles, map layers, offline packs, info pages, participants, features). To confirm, type the **project key** (it is in the address, `/admin/projects/<key>/…`); only then is **Delete** enabled. After that the project list opens. Every admin of the project can delete it. The key is never handed out again; a new project with the same name gets another key. If removing the files fails, the server finishes it the next time it starts.

## Not there yet

## General: Project & release

Status & release, Template and Project file are on one screen (the separate Status & release and Template entries are gone; old links land here). Status and Publish are at the top, then the template with its inputs, then the **Project file**.

- **Project file**: the whole project file of the draft as text. Edit it, or paste a whole file over it, and apply it to the draft with **Apply**.
- The file is checked in full. If there are problems they are listed with their place in the file and nothing is applied; **Reset** brings back the saved version.
- Apply changes the draft only. Nothing goes live until you **Publish**.
