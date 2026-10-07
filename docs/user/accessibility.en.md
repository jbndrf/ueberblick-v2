# Accessibility

Überblick should work without a mouse, with a screen reader, in sunlight and with large text. The target is WCAG 2.1 level AA (BITV 2.0). What is met and what is missing is in the self-assessment `docs/process/bitv-self-check.md`. A template of the accessibility statement for your installation is in `static/accessibility/`.

## What you can use
- **Keyboard:** everything works with Tab, Shift+Tab, Enter, Space and Escape. The first Tab stop is "Skip to content". Escape closes a sheet, and focus returns to where you came from.
- **List instead of map:** if you cannot use the map, pick features in the list. The columns sort, and a row opens the feature.
- **Screen reader:** header, navigation and main area are marked up. Form errors are read as a summary with links to the fields. The connection status and the result of a task are announced.
- **Bright outdoor mode:** black on white with contrast of at least 7:1 and a thicker focus ring (Me, Settings).
- **Large targets:** buttons are at least 44 px, primary actions 56 px high.
- **Reduced motion:** when your device asks for reduced motion, nothing animates.
- **Map zoom without a two-finger gesture:** the map has no zoom buttons. Double-tap (or double-click) zooms in, and on a computer the mouse wheel zooms. With the keyboard, once the map has focus, the arrow keys move it and **+** and **−** zoom. **Location** in the bar jumps to your position. The map is announced with a pointer to the list.
- **Zoom and text size:** text follows your browser settings and can be enlarged.
- **Status never by colour alone:** online, offline, not sent and refused each have their own symbol and a text.

## Known gaps
- The builder needs horizontal scrolling on a very narrow display.
- On a very narrow display (320 px) the participant app's list needs horizontal scrolling, because a long feature id widens the table.
- In the participant app a screen reader does not read the configuration notices (at the top, when the project has a fault) as a list.
- The participant app's map is not yet covered by the browser accessibility test. The list is: sign-in, list, feature sheet and task by keyboard up to submit.

## Report a barrier
The contact is in the accessibility statement of your installation. Describe what did not work, on which page and with which device or assistive technology.

## For administrators
You need the accessibility statement before you use Überblick publicly. Fill in the templates (`erklaerung-zur-barrierefreiheit.de.md`, `accessibility-statement.en.md`). The contact, the enforcement body and the approval are required details only you know. You are responsible for your projects' content (labels, photos, help texts): label photos, and choose colours with enough contrast.
