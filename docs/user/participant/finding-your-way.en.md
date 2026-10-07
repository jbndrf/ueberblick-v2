# Finding your way

The app shows only what your role needs: your project decides the tools for your role.

## Layout
The map is the home screen. Everything else opens as a sheet over the map.

- **Preview notice.** If you signed in to a project's preview, the line "Preview – test data, not the real data" always stands above the header. It cannot be dismissed.
- **Top: the header.** The project icon and name, as the administration set them under Project settings > Branding (a project with no icon shows the Überblick logo). While the app loads data it says "Syncing data (N)" instead or, until the map is ready, "Loading objects ..."; both pulse. On the map, "Loading map ..." shows until then. On a computer the same buttons as at the bottom of the phone sit on the right of the header; the account icon at the far right opens Settings.
- **Bottom (phone): the bar.** From the left: **Layers**, **Filters**, **+** (new), **Location**, **Tools**, **Settings**. Tools exists only when a tool is switched on for you; when a tool has something new, its icon shows a red number (from 100 it reads 99+) or a small grey dot. The bar disappears while you place or change a position.
- **The map** opens where your project says (start position and zoom under Project settings > Standardansicht; a view with its own camera position uses that one). If nothing is set, the map shows the area of the loaded features. Drag it with one finger and zoom with two; it never rotates. Tapping a feature opens its sheet.
- **Marked feature.** While a feature's window is open, the map marks exactly that feature: a blue ring around a point, a heavier outline and a slightly stronger fill on a line or area. Open another feature (for example from Recent or the list) and the mark moves with it; close the window and it goes. When the feature sits inside a group the map shows no mark until you zoom in. On a computer the mouse pointer turns into a hand over a feature or a group.
- **Location** centres the map on your position and marks it with a blue dot with a white ring. A faint blue circle under it shows how accurate the position is; it is true to scale in metres, so it grows and shrinks as you zoom. If the device cannot tell where you are (for example because access was refused), the map briefly says "Location not available".
- **+** opens the sheet for creating. A second tap opens "Recent" beside it, a third closes both. On a computer the **+** in the header does the same.
- **Tools** opens a narrow sheet on the right with one tile per tool that is switched on (for example **Search**, **Measure**, **Project chat**; see [The project chat](how-to/project-chat.en.md)). Tapping a tile closes the sheet and opens the tool. If none is on, the button is not there. While the list stands in for the map, **Measure** is missing: it needs the map to tap on. Your project decides which tools you see for your role; what it only offers you switch on yourself under **Settings**, **Options**, **Advanced features** (see [Settings](settings.en.md)).
- **Layers** opens the map layers: pick the base map, turn overlays on and off (see the [guide](how-to/switching-maps.en.md) Switching maps).
- **Recent** lists the newest objects. Tapping a row flies to the object (at least to street level, with it in the free part of the map, not under the sheets) and opens its sheet; Recent stays open so you can pick the next, and remembers how far you scrolled. Recent lists only what the map shows: what you switched off in the Filter (or an active view hides) is not listed. On a computer it shifts left beside the object's sheet.
- A tap on the empty map closes an object's sheet, New and Recent. Layers and Filters stay open; they also leave an object's sheet open.
- While you place a pin on the map, the bottom bar is hidden; the **x** on the red button brings it back (see [Adding an object](how-to/adding-an-object.md)).
- **List:** The "List" button at the top left of the map shows the same features as a list (also for keyboard and screen reader). If the map cannot be shown (for example no WebGL), the app shows the list by itself and says why. If you start a task from a List row that works on the map (for example moving an object or editing an area), the List closes, the map flies to the object and you place the point or draw the shape as usual. On a phone the list ends above the bottom bar, so its last row can be scrolled fully into view.

## Keyboard and screen reader
The "Skip to content" link is the first tab stop. Areas are marked up as banner, navigation (the bar) and main.

## Outdoor mode
A high-contrast theme exists for sunlight, set by your project for your role.

## A feature's window
On a phone the window of a feature is a sheet from the bottom: first small (about a third of the screen) with the map still usable. A tap on the header bar, or dragging it up, makes it large; dragging down makes it smaller, and from the small size it closes. A swipe at the edge of the content (down at the top, up at the bottom) also changes the size. From 768 pixels wide it is a 450 pixel panel on the right. The cross or the Esc key closes it.

## Activity of a feature
Tap a feature and its window opens on the **Aktivität** tab: what changed, when and by whom, also offline.
- Entries are grouped by stage, newest on top. A blue strip "Moved to: ..." shows when the feature moved into a stage (with a counter such as 2/3 for a repeated visit); tapping it opens **Daten**. The green strip **Created** is at the start.
- Each line names the change ("Befund updated", "Location updated", "3 fields updated" or the task), the task, the name and how long ago it was. Tapping shows the changed values, photos as small pictures.
- Whether you see other people's names is set by your project for your role. Otherwise it says "Someone"; your own changes always show your name.
- Your own changes that have not reached the office yet carry the badge "Waiting to upload", rejected ones "Rejected" (see [When a run is refused](refused-runs.en.md)).
- A change still waiting to upload already reads as it will after the upload: with "Moved to: ..." and every field the task sets, not only the fields you filled in.
- With no entries it says "No activity yet".
- **What you see when you first open the map:** If the administration unticked types or values under Initial view (Erststart), they start switched off in the **Filter**. As soon as you switch something in the Filter yourself, your choice holds and no longer changes when the administration changes the initial view. Your switches are saved with your account: they survive a reload and follow you to another device. The views your administration prepared for your role ("From the project") are in the Filter for everyone in the role, even when the Ansichten tool is off; only your own saved views need the tool. Without a choice of your own you always see the current initial view.

- **Stacking:** on a computer Einstellungen and Werkzeuge open in front of an open feature, not behind it; Einstellungen do so on a phone, too. There an open form covers the bottom bar: the account icon at the top right then opens Einstellungen, in front of the form. With the Neu menu open, the **+** in the header and a row under Zuletzt take a single tap. **Esc** closes only the topmost layer: with the Neu menu open it closes the menu and leaves the feature.
