# Working offline and syncing

You can run tasks without a network. Every submission is stored on your device first and checked at once. You see the result on the map before the server knows it (a preview). The app then sends your submissions **one after the other, in the order you made them**. The device clock plays no part in that.

Without a network the app reports the connection failure to the browser console once per offline period, not at every attempt.

## What you see

| Shown | Meaning | What you can do |
|---|---|---|
| "Not uploaded yet: n." at the feature (after "Submit" the form closes) | The run is stored on the device and perhaps not yet at the server. If there is no connection or the server does not answer, nothing is lost: the app tries again with growing pauses of up to 5 minutes. | Get a connection. The app sends by itself, at once when you reconnect or return to the app. |
| A red bar: "The sign-in has expired ..." with "Sign in again" | Your session expired. The runs stay stored on the device. | Sign in again with a new QR code; the app then carries on. |
| A red bar: "This app version does not fit the server ..." | The server speaks another protocol version than your app. Nothing is sent any more, nothing is lost. | Update the app; it then carries on. |
| A red bar: "Sync has stopped: ..." | The device could not store what the server sent (for example because it is full). | Free some space and reload; tell the administration if it stays. |
| A red bar: "This page is from an older version of the app ..." | The app was updated while this page was open; the page and the sync no longer fit together. | Reload the page. Runs not yet sent stay on the device. |
| A red bar: "Sync has stopped: .... Please reload the app." | The background sync service failed. The same message shows in the settings sheet, under Profile, in the connection card. | Reload the app. |
| "Refused" at the feature | The server or your device refused a run. The list of unsent and refused runs, with the reason, is in the settings sheet under Profile, "Pending changes". | See below. |
| "Config version N no longer exists; the run waits for review" | The project version you worked with no longer exists on the server. The run is kept. | Tell the administration. |

## When a submission is refused

A refusal is shown only when the server explicitly reports it with a reason (see [When a submission is refused](refused-runs.en.md)). A network error, a timeout or an error page from an intermediate server never refuses anything.

- If your device already refuses, the form stays open with your entries ("Not possible"). If the server refuses, the change stays on the device with its values; fix the cause and use "Send again", or "Discard" it. An overview of all unsent and refused runs is in the settings sheet under Profile, "Pending changes".
- If more submissions follow, the app checks them again against the real state. Only those that would no longer be valid are refused too. All others are sent.
- A batch (several changes that belong together) is accepted entirely or not at all. If it is refused, all its changes are refused.

## When storage is full

If the device is full, the app says so at once and does not store the submission halfway. Free some space and try again.

## Starting without a network

The app remembers your name, the project name, the project icon and when your session ends. If you start it without a network it shows the same header and profile as last time. When you sign out or the session is ended, what it remembered is deleted. Signing out also deletes that person's data on the device, including their offline map packs. If your session ends by itself (it expires, or the server refuses it), the app takes you to the sign-in page, and changes you have not sent yet stay on the device and are sent after you sign in again. An offline start with an expired session also opens the sign-in page.

## Installing the app and updates

The app also starts without a network once you have opened it online one time: the browser keeps the app on the device on the first visit. To install it, use your browser's function (the function that adds the app to the home screen); the app then opens full screen on the map.

On iPhone and iPad there is no Install button: the card under Settings > Offline shows the steps instead (in Safari Share, then Add to Home Screen).

The app fetches new versions by itself. When one is ready, the page reloads. If a form is open, the app waits until you close it; your draft is kept.

## Map without a network

The app loads map tiles from the network on demand. For areas without reception, download a map pack beforehand: Settings, the "Offline" tab, "Download tiles" (see [Settings](settings.en.md)). A downloaded pack is used for the map at once and at every start. Packs belong to you and the project you downloaded them in: other people signing in on the same device, or another project, neither see nor delete them; packs from earlier versions must be downloaded once more. If you zoom in further than the pack reaches, the app shows the pack's coarser tile enlarged (blurry). Without a pack, or outside its area, the map stays empty and your features stay visible.

## Two tabs, two people

A browser has only one sign-in, even when several tabs are open. If you sign in as another person in a second tab (for example through the QR code), the first tab switches to that person at once. A change of the first person that has not been sent yet is never sent under the new person's name. It stays on the device and is sent when the first person signs in again. Two tabs of the same person work side by side without trouble.
