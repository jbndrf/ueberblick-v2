# Demo instance

The demo is a ready-filled Überblick installation to try out on your own network. It shows three projects with sample data: a tree cadastre (Musterstadt), a defect reporter (Stadtwerke) and event approvals (Ordnungsamt). **For looking around only: not for real use.**

## Start it (operators)
`npm run demo` builds the app, fills the data on first use and starts the server. A handout then appears on screen and in the file `DEMO.md` in the demo folder (default `~/ueberblick-demo`). `npm run demo -- --reset` restores the sample data. Your entries survive a restart. Ctrl-C stops the demo.

## Sign in as a participant
The handout has one sign-in link per project and role (for example Anna, tree inspection). Open the link on the device. Each link works again and again, also on another device. Your sign-in lasts 90 days and is extended every time you use the app. More links: `npm run demo -- --links`.

The browser warns once about the certificate because it is self-issued. Choose Advanced in the browser, then Continue. Without https the app does not work on other devices.

## Sign in as admin
Open `https://<address>:4173/admin/login` and sign in with email and password (both are in the handout; there is no one-time code). Then open a project, its Participants page, and copy a login link or export QR badges.

## What to try first
1. As Anna, open a tree in the list and run the Regelkontrolle.
2. The map: one tap on a cluster's number opens a sheet with the group's features; tap twice quickly to zoom in.
3. As admin, open the Participants page and copy a login link.
4. Under "Me" switch language and theme.
5. As Anna or Vera, turn on **Ansichten** and **Cluster** under Settings, Options, Advanced features (Erweiterte Funktionen): the map contents sheet then shows the Ansichten and Cluster tabs.
6. Open a Maßnahme: the sheet shows the path to its tree. A tree shows its Maßnahmen as a list (species and areas are only links and have none).

## Good to know
- The map has no internet basemap, so it works offline too. It opens at the project's start view (in the tree cadastre the whole town, so the trees show as one cluster at first).
- "Data at risk" in the header means the browser did not promise persistent storage. On a demo device that is normal.
