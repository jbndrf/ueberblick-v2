# The admin area

After signing in you see the sidebar on the left and a slim header on top. Every admin page appears in this frame.

## Sidebar
- **Projects** leads to the project list (`/admin/projects`). With no project open, "Your projects" below it has one entry per project.
- **Inside a project:** the project name, then Project settings, Participants, Roles, Relations and Versions, below them the foldable groups **Feature types** (every type except the tables) and **Tables** (types with no geometry and no process). The addresses are `/admin/projects/<project>/<page>`.
- **Feature types and tables:** each entry shows its icon; a feature type opens its data page (see *Viewing the data of a feature type*), a table opens its table page (see *Creating and maintaining tables*); the heading of the group "Tables" opens the overview of all tables; the current one is highlighted. The list comes from the draft, so new and reordered entries show at once. The **+** of a group creates a new feature type or table: enter a name, press **Create**, the builder (feature type) or the table page (table) opens and the yellow "Unpublished changes" bar appears. Drag feature types with the mouse into the order you want (a line shows where the entry will drop); the order belongs to the draft. With the keyboard: focus an entry and press Alt + Arrow up or Alt + Arrow down. On a phone the sidebar opens as a sheet: lists and **+** work there, sorting by drag does not.
- Pages that are not finished yet show "This page is not ported yet." in the same frame.
- **Instance Settings** sits at the end of the sidebar below a divider (see *Instance settings*): the consent window and legal pages of the whole instance.
- The button at the left of the header (or Ctrl+B) folds the sidebar in and out; on a phone it opens it over the page.

## Unpublished changes
Settings that change the project (roles, columns, Objektarten in the builder) go into the **draft** first. While the draft differs from the running version, a yellow bar "Unpublished changes" with a **Publish** button sits under the header of every project page; in the sidebar the same message shows as a yellow badge under the project name (it leads to Versions).
- **Publish** opens the deploy overview (see *Deploy a project*): what changes, what happens to running objects and to the values of removed entries, and the confirm. Then the bar and the badge go away, and "Version n is live." shows briefly.
- **A new project is not live.** Until the first publish it says "Not published"; participants see nothing. The first publish makes version 1.
- **Problems** (for example a reference to an Objektart that does not exist) prevent publishing. The bar gives their count and "Open in the builder" leads to the Objektart; the overview lists them under "Fix first:" and "Go to" opens the place.
- If a change moves existing values (for example a removed option), the overview asks for the target ("move to") or "Discard values".
- **Participants** are not part of the draft: adding or changing them applies at once and does not turn the bar yellow.

## Account menu
The icon at the top right shows your e-mail address and offers:
- **Theme:** light or dark. The browser remembers the choice.
- **Language:** Deutsch or English. The browser remembers the choice (a cookie).
- **Sign out:** ends only the admin session. A participant session in the same browser (for example the map in another tab) stays signed in, and the other way round.

## Viewing changes
In the deploy overview and in the project status (Settings, "Project status") **Compare project file** shows the whole project file side by side as a line diff: live on the left, draft on the right, changed lines on one row. Red (left, marked with a minus sign) = in the live version but no longer in the draft; green (right, marked with a plus sign) = new in the draft. On a phone you scroll sideways. Unchanged stretches are folded ("n unchanged lines", tap to open). Before the first publish everything is new. The change list also says in brackets what changed in an entry (for example `form.datum` for a task).
