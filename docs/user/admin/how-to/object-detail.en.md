# Look at one object

Click a row on the data page of an object type. The page of that object opens: everything you want to know about the one object, and what has happened to it. It is read-only; you change an object in the participants' app or, as an admin, in the edit mode of the data page (see *Viewing the data of a feature type*).

**Back:** "Back to objects" at the top left returns to the table as you left it: search, sort and filters stay as long as you stay in the same browser tab. The scroll position is not kept.

**Header:** the object's display name, with its object type under it. Then "Stage" (only for object types with a process), "Status" (active, completed, archived or deleted; deleted objects open here too), "Created by" (the person's name; if they are no longer in the list, their id is shown), "Created on" and "Last changed".

**Location:** for object types with a geometry, the shape on the project's base map (like the preview in the table, but as wide as the page) with the coordinates below. An object without a location says "No location set".

## Data

Every property of the object with its name and value, in the order of the object type. Properties you gave their own tab in the form form their own group; all others sit under "General". Stage and location are in the header and the location field, not repeated in the list. Values look as they do in the app: names instead of ids, choices as badges, files as thumbnails (a click enlarges). An object without values says "No data recorded for this object."

## Activity

Everything that has happened to the object, newest first, grouped by the stages it went through (for a stage the object visited several times, `(2/3)`). Each line says what was done ("Location updated", "2 fields updated" or the task), the task, the person and the time. A click on the line shows the values written. The green line is the creation of the object.

**Changes the server refused** are in the list too, marked "Refused"; their detail gives the reason. They changed no value.

50 changes load at a time; "Load more" fetches the next ones until the creation is reached.

## Protocol of a change

Under every line of the activity (for a stage change, after the time under the stage heading) there is **Open protocol**. It opens that one execution as a filled form, read-only: **Protocol of <date>, <person>**, then the task and every field of the task form with the values written at the time. A change the server refused has no protocol.

The form is the one the change was made with: if the form was rebuilt since, you see the old version. Fields the viewing person may not read are left out entirely; as an admin you see every field. Fields that were hidden or not written at the time appear empty. If the task had no form (for example a quick edit), the protocol shows the properties it wrote.

**Export as PDF** opens the browser's print dialog; choose saving as PDF. Only the title and the form are printed, without the sidebar and buttons. **Back to activity** returns to the object page.
