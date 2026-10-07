# Drawing a line or an area on the map

Some kinds of object are a line (for example a hedge or a fence) or an area (for example a damaged patch). You draw them directly on the map, with the map's background under your finger.

1. Tap **+** at the bottom and tap the kind of object. The map stays, and a stack of grey buttons appears at the top right.
2. Tap the map to add a point. A line needs two points, an area needs three. The active part is drawn in red, the outline of an unfinished area is dashed.
3. To move a point, drag it. For an area, tapping the **first point** closes the outline.
4. Tap **Done** (the green check) when the shape is complete. The form opens with the shape in it. The cross at the top cancels the drawing.

The buttons, top to bottom:
- **Cancel** (cross): leaves the drawing without keeping anything.
- **New part** (plus) and the numbered buttons **Part 1, 2, …**: only for kinds that may have several parts (for example a hedge with a gap). **New part** starts another part; a numbered button makes that part the active one, so you can keep adding points to it.
- **Undo** and **Redo**: step back or forward in the active part, one change at a time. They show only when there is something to undo or redo.
- **Delete part** (bin): removes the active part and renumbers the rest.
- **Done**: grey until a part has enough points.

Good to know:
- If the shape is not valid, for example an area whose edges cross, **Done** says "Not accepted: …" with the reason, and the drawing stays as it is. Move a point or tap **Undo**.
- Small technical problems are fixed for you, for example the direction in which an area is drawn.
- Kinds without several parts show only one shape: there is no **New part**.
- A geometry field in a form only shows what was drawn ("Area: 1 part(s), 4 points"); drawing itself always happens on the map.

## Changing a location or a shape (for example moving a tree)
A task that only changes the location opens no form but goes straight onto the map. The pin starts at the current location; for a line or an area the current shape is already loaded.
1. On the feature, tap the task (for example **Move tree**). The sheet steps aside and the bar at the bottom hides.
2. Drag the pin or tap the new spot; for a line or an area, drag the points or draw again.
3. Confirm with the red button (the task's name) or **Done**. Exactly one change is saved. The cross cancels without writing anything and the sheet comes back.
If the server refuses the change, the reason shows in the notice at the bottom right. If the task has more fields, the form opens after the map with the new position.
