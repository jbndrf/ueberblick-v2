# Getting started

You need a phone with a browser and the QR code the administration gave you.

## Signing in
1. Scan the QR code with the camera. The link opens the sign-in page and a moment later you are signed in. The app then shows the map.
2. The QR code (or your access code) works **again and again**, on every one of your devices, until it expires or is withdrawn. If the app says your access is no longer valid, it was withdrawn, has expired or your account is disabled: ask the project team.
   Your sign-in lasts 90 days and is extended every time you use the app. If you sign in on the same device with a different QR code (for example on a shared phone), that replaces the previous sign-in; the previous person's data stays on the device but is not shown.
3. You need a network connection once, to sign in. After that you can work without one (see [Working offline and syncing](offline-and-sync.en.md)).

### Without the camera link: on the sign-in page
Open the sign-in page (`/login`). Top right you set language and light/dark; the choice stays on the device.
- **Token sign-in:** type your access token (the eye shows it) and tap "Sign in".
- **QR code:** open the tab, tap "Start camera" and point the phone at the QR code, or upload a photo of it with "Upload QR image". A recognised code signs you in at once. A whole sign-in link inside the QR code works too.

If the field is empty, "Token is required" appears under the field. The page does not scroll.

Messages: "Invalid or expired token" (wrong or withdrawn), "The token has expired", "This account is inactive", no connection and "Too many sign-in attempts. Please try again in {minutes} minute(s)."

### Consent and legal notices
If the operator requires your consent, the sign-in page first shows a window with the notice. At the bottom are the legal pages (for example the imprint) that you can read there ("Back" returns to the notice). "Accept" lets you continue, also with a sign-in link; "Reject" keeps the window open and you cannot sign in. Your choice holds for one year on this device. Anyone can read the legal pages without signing in at `/legal` and `/legal/<name>`.
### Joining as a guest
If the administration gave out a public link or QR code for guests (for example for a defect reporter), open it: the page "Join as a guest" optionally asks for your name (empty: `Gast`), signs you in as a guest and takes you to the map. On the same device the link later brings you back to your existing guest. Guests are deactivated after 90 days without activity; as long as you use the app, the access stays. If the operator requires consent, the link first leads to the sign-in page with the consent window and, after "Accept", back to the guest join. The administration can limit how many objects a guest may create.

## The first start
The first time you open the app it loads the features of your project onto the device. For a large project this can take a moment; the header shows "Syncing data (N)" meanwhile. After that the features are there without a network too.

## What you see
Your role decides what the app shows: the tools (Search ...) and the tasks. What your role does not need, you do not see. More in [Finding your way](finding-your-way.en.md).

## The usual things in three taps
- **Look at a feature and run a task:** tap the feature on the map (or in the list), pick the task, fill it in, "Submit". On the map a tap takes a point first, then a line, then an area, so a tree inside an area opens the tree; a tap on the bare area opens the area.
- **Create a new feature:** **+** in the bar, pick the task, fill it in (you set the location on the map: drag the pin to the spot or draw a line or an area), "Submit".
- **Without a network:** the same. The form closes as usual; the run waits on the device until the connection is back. The app then sends by itself.

## Signing out
Account icon at the top right (or "Settings" in the bar), tab "Profile", "Sign out". On a phone you reach the account icon with a form open, too. Signing out deletes your data on this device, your offline map packs included, unsent changes too (the app asks first). Without a connection you cannot sign out. The Settings sheet asks first when changes are unsent (see [Settings](settings.en.md)). The address `/logout` also ends the session; you then see the sign-in page.

## Notes at the top of the app
When the app finds a fault in the setup that it cannot fix, it says so in a red bar at the top, with a code and a name: for example a map that will not load (`map_unavailable`; the list shows the same features). Pass the message on to the administration.

## Your personal settings
Appearance (light/dark, font size, language), the tools you switched on and your saved filters belong to you, not to the device. The tool switches are in Settings, Options (see [Settings](settings.en.md)); the other settings follow you on every device you sign in to. Map packs stay on the device.
