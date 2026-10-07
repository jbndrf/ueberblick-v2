# Settings

The Settings sheet has three tabs with icons: **Profile**, **Options** and **Offline**. The sheet remembers the tab you opened last. The bottom bar's "Settings" opens the sheet.

## Profile
- **Online / Offline** and **Sync now**: whether the server answers (not only whether the device reports a network; the app checks every 5 seconds while the page is visible), and the button that syncs at once.
- **Last synced**: when your data last came from the office. If it is a week old or more, a warning appears.
- **Pending changes**: everything still on your device. A row shows the task and its state (waiting, uploading, refused). Tap the name and the map jumps to the object and opens it.
  - **Send again** sends a refused change once more, after you fixed the cause.
  - **Discard** removes a change from your device before it reaches the office; nothing of it is sent. A change that is being uploaded right now cannot be discarded until the upload is done.
- **Sign out** ends the session on this device. If unsent changes remain, the app asks first, and they are lost when you sign out. Signing out also deletes your data on this device, including your offline map packs (other people's packs stay). Without a connection you cannot sign out: the app says so and you stay signed in.
- **Name**: your name is on the card above "Sign out", with your e-mail below it when one is on file.
- **Roles**: your roles in the project. When an administrator takes a role from you or gives you one, the profile shows the new roles after the next sync (also "Sync now") without reloading the app, and the tasks of that role are no longer offered. The device needs a connection for this. The change applies in place: the map does not reload and open sheets (Settings, an open object) stay open. A change the server refuses because of the new roles then shows on the object and under "Pending changes".
- **Info pages**: the project's help pages, right under the roles. Tap one to read it in a window. If it shows a QR code of your login, scan it with a second phone to sign in there; the page can also show your token and login link when its text says so.
- **Legal**: the operator's legal pages (for example the imprint). Tap one to read it in a window. Info pages and legal pages are stored on the device and work offline.

## Options
- **Theme**: light or dark.
- **Font size**: XS to XL. At XL the map bar shortens long labels with an ellipsis; the full name shows on hover or long-press.
- **Language**: EN or DE. It is the same choice as on the sign-in page: what you pick there is what the app shows, and the other way round.
- **Advanced features**: a collapsible box with one switch per tool that your project offers your role or has switched on. The number beside it counts what is on. A tool that is only **offered** starts off, an **active** one starts on; you can change both. The switches belong to you, not to the device: they apply on your next device too. Offline, a switch takes effect at once and is sent later. If your role has no tool, the box is not there.

A choice applies at once and stays after a reload. Theme, Font size and Language belong to you, not to the device: on another device you sign in to, your look follows after the first sync (until then the device's own setting shows). Offline, a change takes effect at once and is sent later.

## The Offline tab

- **Install the app**: shows whether the app is installed or runs in the browser, and offers **Install** as soon as your browser allows it. On an iPhone or iPad there is no such button; the card shows the steps for Safari. Only an installed app can start without an internet connection. **Technical details** show the status of the service worker and of the install prompt.
- **Map tiles**: shows the map packs on your device with name, date, number of tiles and size. **Download tiles** (or **Change area**) opens the list of packs your project provides; **Download** loads a pack with a progress bar. The window cannot be closed while a download runs. While one runs, a card "Downloading offline data..." also sits above the bar. **Delete** removes a pack after a second confirmation. An interrupted transfer continues where it stopped on the next try. If the device has no room for packs, the card says so. Of every downloaded pack the app also saves a copy as a file (`.ubpack`) in your Downloads folder ("Saving to Downloads..."). At the bottom of the window, **Import pack from file** imports such a file, for example from another device: the app reads it, checks every map layer and shows "{n} tiles imported". A file that is not a pack, is cut short, does not belong to this project or whose checksum is wrong is refused with the reason in your language, and the device keeps its previous pack. An imported pack is used for the map at once and counts like a downloaded one: when the server has the same version, the app downloads nothing again.
- **Offline images**: a switch under the map tiles. When on, the device saves low-resolution photo thumbnails of your features' images ("Downloading thumbnails...", with a counter) so you can see images without a connection; afterwards it says "Photo thumbnails are saved for offline viewing." When off, the device removes every saved thumbnail ("Removing cached images...") and no photos appear offline. Full-resolution photos always come from the server when you are online. The switch belongs to you, not to the device: on a new device it is already on and the thumbnails load at the start. New photos after a sync, or when the connection returns, are added on their own. A device without IndexedDB does not show the switch.
- **Storage**: how full the device is (bar: orange above 70 %, red above 90 %), the number of tiles, files (the saved photo thumbnails) and records, and whether the browser promises to keep the storage ("Enabled" or "Not guaranteed").

