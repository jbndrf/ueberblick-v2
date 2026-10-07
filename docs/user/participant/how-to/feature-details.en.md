# A feature's details

Tap a feature on the map or in the list. Its sheet opens from the bottom at partial height. At the top is the feature type (for example *Tree*), below it the feature's name, the same name the list shows. When the device knows when the feature last changed, the time follows (*2h ago*).

- **Size:** tap the header or drag it up and the sheet fills most of the screen. Drag it down and it shrinks again, then closes. On wide screens the sheet is a column on the right.
- **Tasks:** below the header is one button per task you may start on this feature. The row scrolls sideways. If the task has a form, a tap opens the form. If it has none, it runs at once and the sheet shows the new state right away. If you may start none, the row is not there.
- **Activity:** who did what and when. While no activity can be shown yet, it reads "No activity yet".
- **Data:** the values of the feature with their names, in the order of the configuration. Values your role may not see are not there at all. Dates and numbers follow your language. An area shows its size in m², a line its length in m; coordinates are never shown. A value that is not set reads "No value". Photos appear as a picture strip you page through as in the form; tapping opens the large picture.

- **Path in the header:** when the feature belongs to another (a tree in an area), the header shows the path *Area › Trees › Tree*. Tap a part to open the area or its list. A red count says how many child features still have tasks for you. With several parents, the arrow on the first part picks the path. Long paths collapse in the middle to three dots; tap them for the whole path.
- **Linked objects:** the arrow after the feature type opens a menu with the feature's relations and the number of children. Tap one to see the list: features with open tasks first, finished ones faded at the end. Where you may create a child, "New {name}" appears (in the menu when there is none yet, otherwise at the top of the list); that task is then not in the action row.
- **Children at the parent's location:** Some children (for example measures at a tree) have no location of their own. They are not drawn on the map one by one; they sit under the parent and follow it when it is moved. Open the list of these children and they fan out above the parent: up to five icons, open ones first, plus a **+N** button for the rest (it opens the parent). Tap an icon to open that child; tapping the empty map or closing the list puts the fan away.
- **Run notices:** above the actions are this feature's refused changes with the reason, **Send again** and **Discard**, and "Not uploaded yet: {count}" while changes wait.

Close the sheet with the close button or the Escape key. Everything works with the keyboard and a screen reader.

If your role has the project chat, the sheet has the menu **More actions** at the top right with **Mention in chat**: it opens the chat with a mention of this feature in the text field (see [The project chat](project-chat.en.md)). While a form or a quick edit is open, the menu is missing.
