# Problems in the project file

The builder checks your project file continuously. Each problem names the **path** (for example `tasks.kontrolle.when`), an explanation and a concrete **hint on how to fix it**. For errors inside expressions, Überblick also shows the position in the expression.

The explanation and the hint are shown in the language of the builder (German or English). An error inside an expression (a syntax error, an unknown name, a wrong type) is worded the same way, with the values filled in, so the detail is in the builder's language too.

**Errors** block publishing. **Warnings** do not, but they usually point to something you did not intend.

| Problem | Kind | Meaning and fix |
|---|---|---|
| Dangling reference | Error | A key names something that does not exist (feature type, task, property, view, role, option, locked path). Use one of the listed existing keys or create the missing element. |
| Expression does not parse | Error | The expression is syntactically wrong. The hint names the position. |
| Expression does not type-check | Error | A name or type is wrong, for example a property that does not exist or text compared with a number. The hint often suggests the right name. |
| Reserved key | Error | The key is a reserved word (`self`, `form`, `value`, `actor`, `inputs`, `other`, `now`, `true`, `false`, `null`, `in`). Choose another key. |
| Rule cycle | Error or warning | Automatic actions trigger each other. Without a condition (`when`) the chain never ends (error). With conditions, make sure one turns false after a run (warning). |
| Automatic action after a task of another feature type | Error | The action runs `after` a task that is offered on another feature type than its own task. Pick a task of the same feature type. |
| Schedule without Objekte | Error | A `schedule` on a task offered on a feature type has no Objekt without `idle` and is refused on every tick. Fill in `idle` (0 days = every Objekt). |
| Condition trigger without Objekt | Error | An automatic action without a trigger (it fires when its `when` becomes true) on a task offered from `$map` or `$none`: there is no Objekt to watch. Offer the task on a feature type or pick another trigger. |
| Several triggers | Error | An `auto` entry has more than one of `after`, `change`, `elapsed`, `schedule`. Keep one and give the others an entry of their own. |
| Option never set | Warning | No task, default or role preset can set this option. Add a step under `then`, or remove the option. |
| Task never available | Warning | The task's `when` can never be true, for example because it names an option or role that does not exist. |
| Derived relation without spatial check | Error | A `derive` needs a spatial check (for example `within`, `intersects`) as its own `&&` part. Nested under OR, NOT or a conditional (`?:`) it cannot narrow the candidates. Example: `self.datum == other.datum && intersects(self.geometry, other.geometry)`. |
| Derived relation reads related features | Error | A `derive` condition reads only own properties of `self` and `other`, not features reached through a relation. Remove the relation read (`self.<relation>…`, `other.<relation>…`): the derived relation would go stale when the related feature changes. |
| Time in a derived relation | Error | A `derive` may not read `now` or `today()`: a derived relation must not change with time. Compare against a property instead. |
| Filter not expressible as SQL | Warning | `permissions.visible_when` uses something the server cannot translate into a database query (for example spatial checks on stored geometries). The server then hides every feature of that type. Rewrite the filter with comparisons on properties, relations and `actor`. |
| Form field nobody may write | Warning | A task form has a field that no role who may run the task is allowed to write, so every run is refused. This includes read-only and calculated fields. Add a role to `permissions.write` for that property (or use `$all`), or remove the field from the form. The check warns only when none of those roles may write the field; a field that only some of them may write is not reported, so check each role yourself. |
| Personal property indexed | Warning | A property marked `personal` has `index: true`. Remove the index. |
| Personal property visible to all | Warning | A view carries a personal property that every role can see. Restrict it with `permissions.see`. |
| Locked path changed | Error | The template locks this path. Remove the change from your project, or use an input of the template. |
| Computed with a default | Error | A computed property also has a default. Remove it: Überblick computes the first value when the object is created. |
| Computed property is written | Error | A task (form field, quick edit, location step or `then` step) writes a computed property. Take it out of the task. |
| Computed in a circle | Error | Computed properties read each other (or themselves). Let one of them read a property that people write. |
| Computed input not supported | Error | The expression reads a relation, a referenced object, `actor`, `now` or `today()`. A computed property may read only its own object's properties. |
| Unknown path | Error | The change names a path the template does not have. Use `add` for new elements. |
| Path already exists | Error | The change adds a path the template already has. Use `override` to change existing elements. |
| Hidden element still used | Error | A hidden element is still referenced. Remove the reference or do not hide it. |
| Offline pack: unknown layer | Error | A pack lists a map layer the project does not have. Use a key from `map.layers`. |
| Offline pack: layer cannot be packed | Error | Only layers from a PMTiles source, a tile URL or OpenStreetMap can go into an offline pack (not WMS or GeoJSON). Remove the layer or use one of those sources. |
| Offline pack: zoom range | Error | The lowest zoom is above the highest, or a zoom is outside 0 to 22. |
| Offline pack: area | Error | The area must be west, south, east, north in degrees, with west left of east and south below north. |
| Offline pack too large | Error | The estimated tile count or size is above the limit for one pack. Make the area smaller, lower the highest zoom or drop a layer. |
| Offline pack: unknown role | Error | The pack names a role the project does not have. |

When two versions of a project file are compared, Überblick marks **breaking changes** (removed feature types, properties, relations, tasks, form fields, rules, views, layers, inputs, roles, tools or options; a changed property, input or geometry type). They need a mapping or a migration before you publish.
