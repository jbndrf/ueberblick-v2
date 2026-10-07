# Filling in forms

A task with details opens a form. Fill it in and tap **Submit**; the change is saved on your device and sent as soon as you are online. Then you are back at the feature. If you created a new feature with **+** (also one without a position on the map, for example a species), its detail opens after you submit; if its type was switched off in the filter, it is switched on again.

## Where the form appears

The form opens in the same window as the feature sheet: on a phone from the bottom (at full height first; a tap on the header or a drag makes it small), from 768 px as a side panel on the right. The map stays usable. The title is the feature type, for example Tree. The button bar sticks to the bottom: **Cancel** on the first page, **Back** after that, plus **Next** or **Submit**. **Cancel** and the cross close the form; a started draft is kept.

While submitting, the button shows "Submitting…" and every button is locked. As soon as the change is saved on your device, the form closes and you are back at the feature, online or offline. There it says "Not uploaded yet: 1." until the server has accepted it, or "Refused" with the reason (see [When a run is refused](refused-runs.en.md)). If your device itself refuses the change, the form stays open with your entries and a red box "Not possible" gives the reason; **Dismiss** hides it, nothing was saved. A task without fields has the button "Create Entry".

## Pages

A long form has several pages. Tabs sit at the top, named by the administrators ("Page 1", "Page 2" and so on when a page has no name), and you can tap any of them at any time. A page with a name shows it as a heading above its fields, with a short description under it when there is one. **Next** and **Back** only turn pages and check nothing.

Only **Submit** checks every page. If something is missing, the first page with a problem opens. A red counter on a tab shows how many entries are missing on that page ("{count} missing"). It shrinks as you fill things in.

## Tasks with several steps

Some tasks have several steps, for example a form first and then the location. "Step 1 of 2" sits at the top. Each step has its own page (a form step keeps its pages and tabs). **Next** goes to the next step, **Back** returns to the one before; what you entered is kept. **Submit** appears only in the last step: everything is then saved together as one submission.

- **Location step:** the map opens by itself. Tap the map or drag the pin there (also inside an area; the area stays unchanged), or redraw the shape and confirm the location. "Choose location on the map" opens the map again later. You cannot go on without a chosen location. For an existing object the step starts at its location: the map shows it at street level, the pin (or shape) is already there, the step counts as chosen, and a location left unchanged is not saved again.
- **Quick edit:** when a quick edit is the only step of the task, no form opens. The feature sheet shows the chosen properties as input fields under **Daten**; the rest stay text. **Save** sends only what you changed. A field you empty is cleared. **Cancel** discards the changes.

## Buttons

Each task has its own button with its own label, colour and possibly an icon. If the administrators set a confirmation, a task without several steps asks it right after the tap; **Continue** starts it, **Cancel** does not. A task with several steps (for example "Edit": data and location) asks it at **Submit** instead; **Continue** saves, **Cancel** keeps you on the last step and nothing is sent.

## Fields

- A red star on a field means it is required. Help text and errors appear under the field.
- Fields the administrators placed side by side (left and right of one row) are half as wide and sit next to each other on a phone too.
- An empty field may show a grey example text (a placeholder) that disappears as you type. E-mail fields show an example address and the phone keyboard with @.
- Date, time and date-with-time fields use your device's own input. A date with time is in your device's local time; the exact moment is what gets saved. If the administration prefilled a date field with the current date, it already holds today's date; you can change it.
- If you switch the language while a form is open, the field labels follow at once; what you typed stays.
- Multilingual text fields show and change the text in your language; the texts in the other languages stay as they are. If your language is missing you see the available one until you type. Emptied, only your language is removed.
- Fields that do not fit the situation do not appear, and they show up by themselves when they do.
- A field can show and change a value of a linked feature, for example the inspector's phone number. It is marked "From <feature type>" and starts with the current value. What you change is saved on the linked feature in the same submission; if you may not change that value, the submission is refused. A read-only field only shows the value. If the linked feature does not exist (or is not on the device), the field does not appear.
- Other files than photos are added with the Files button (see Adding files).
- You take photos in the field itself (the buttons "Take photo" with a camera icon and "Choose photo" with an image icon); they are sent along with the task. A field can hold several photos, up to the maximum set for it. All photos show as a strip of pictures above the buttons (three at once in a full column; page on with the arrows at the edge, the mouse wheel or by swiping); the x on a picture removes it. Tap a picture to see it large: arrows or the arrow keys page through, Esc closes. Photos not yet sent also show without a connection. The same pictures appear later in the feature sheet under Data.

## Choice fields

Fields with a list of answers (a choice, several choices, a person or another feature) open the same way as in v3.

- **On a phone** the list fills the screen over a blurred background and stops above the keyboard. At the top is a search box: type to narrow the list (it searches the name and the description). Tap an entry to pick it. With several choices, the picked entries show as small tags in the search box, and the x on a tag removes it. **Done (n)** at the bottom closes the list; tapping the background does too.
- **On a larger screen** a small list opens under the field (above it when there is no room below). The search box has the cursor at once. The arrow keys move the highlight, Enter picks, Backspace in an empty search removes the last tag, Esc closes.
- **Person:** When assigning, and for similar fields, you see the members of the project by name when your role is allowed to (the project sets this); otherwise only yourself, or no choice for a role that is not allowed. The list arrives with the sync and works offline. A member without a name shows as "Someone".
- With one choice, picking an entry closes the list. With several, it stays open until you close it.
- The field shows the picked name, or the tags while the list is closed, and "n selected" while it is open.

- **Dependent choice:** When a choice depends on an earlier answer (for example the variety on the group), the list shows only the matching entries. As long as the field the choice depends on is still empty, a hint "Select a value in the dependent field first" stands in place of the choice. An entry can have an explanation text, shown under its name. If you change the earlier answer so that your previous pick is no longer offered, the field is emptied. If a value was already stored there, "Fields will be cleared" asks before you submit (see below).
- **Number limits:** When a number has a minimum or maximum, the input field already knows them (the arrow keys and the on-screen keyboard follow them). The check at submit is unchanged.

## "Fields will be cleared"

When you change an answer, other fields that already held a stored value can drop out. If **Submit** would delete such values, the app asks first and lists the fields. **Clear & save** deletes the values and submits. **Cancel** returns you to the form and nothing is sent.

You set the location on the map (pin or drawing, also when moving an object). The form does not show it as a row; it is saved when you submit.

A computed field is never editable: while it has no value it shows "Will compute on save" and a "Computed" badge. Its value is not submitted.

## Fields of a linked Objekt

A form can show and edit a field of a linked Objekt, for example the name of a tree's area. The field carries a small label with the Objektart it comes from. Submitting saves the value on the linked Objekt. When that Objekt is not on the device (offline, not yet synced), the form hides these fields.
