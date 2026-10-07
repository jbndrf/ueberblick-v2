// The demo handout: what `npm run demo` prints after the server is healthy, and writes to <dir>/DEMO.md.
import { networkInterfaces } from 'node:os';

/** The IPv4 addresses of this machine that are not loopback, one per interface address. */
export function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a !== undefined && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

export const WARNING =
  'DEMO ONLY: a published admin password, a self-signed certificate (plain HTTP with --http). ' +
  'This is not a production setup. Do not expose it beyond a network you trust.';

const JOURNEYS = [
  'Participant, map: open a link below (it signs you in and lands on /map), tap an object on the map to open its sheet (Daten, Aktivität), then a task under "Aufgaben" (for example "Regelkontrolle" as Anna).',
  'Participant, list: tap "Liste" (top left of the map) for the objects of the visible map area, and tap a row to open its sheet.',
  'Participant, new: tap "Neu" (the plus in the bottom bar, in the header on a desktop), pick what to create (for example "Mangel melden" as Mia), move the pin to the spot, confirm, fill in the form and tap "Absenden". A second tap on "Neu" opens "Zuletzt", the objects you worked on last.',
  'Participant, status and settings: "Daten werden synchronisiert (n)" in the header appears while data loads onto the device (n = objects loaded); "Einstellungen" (bottom bar, header on a desktop) has the tabs "Profil" (the last sync, "Ausstehende Änderungen") and "Optionen" (language "Sprache", "Darstellung", font size "Schriftgröße").',
  'Admin, sign-in: open /admin, enter the e-mail and the password, then open a project under "Projekte".',
  'Admin, participants: in a project open "Teilnehmende", then "QR exportieren (n)" (n = the selected participants) or "Neuen Token erzeugen" for a participant. A QR login can be used again.',
  'Admin, model and roles: in a project open "Objektarten" and "Rollen". Changes are a draft until "Veröffentlichen".',
  'Admin, versions: open "Versionen" to see the versions, compare two, or switch one live again.',
];

/**
 * @param {{ addrs: string[], port: number, scheme: string, dir: string, email: string, password: string,
 *   projects: { key: string, title: string, try: string }[],
 *   links: { project: string, id: string, name: string, roles: string[], token: string }[] }} h
 */
export function handoutText(h) {
  const hosts = [...h.addrs, 'localhost'];
  const primary = h.addrs[0] ?? 'localhost';
  const base = `${h.scheme}://${primary}:${h.port}`;
  const L = [];
  L.push('# Überblick demo', '', `WARNING: ${WARNING}`, '');
  L.push('## Open it from any device on this network');
  for (const host of hosts) L.push(`- App:   ${h.scheme}://${host}:${h.port}/`);
  if (h.scheme === 'https')
    L.push(
      '',
      '## First: install the certificate (once per device)',
      `- Open ${base}/setup/zertifikat and install the certificate it offers (the page says how for iOS, Android, Windows and macOS). Without it Chromium does not register the service worker on this self-made certificate, and the offline part of the app ("Einstellungen") fails.`,
    );
  L.push('', '## Admin');
  L.push(
    `- Sign in at ${base}/admin with email ${h.email} and password "${h.password}" (e-mail and password only).`,
  );
  L.push('', '## Participants (sign-in links; open one per device, then the device stays signed in)');
  for (const p of h.projects) {
    L.push(`### ${p.title}  [${p.key}]`);
    for (const who of h.links.filter((l) => l.project === p.key))
      L.push(`- ${who.name} (${who.roles.join(', ')}): ${base}/login?token=${encodeURIComponent(who.token)}`);
    L.push(`  Try: ${p.try}`);
  }
  L.push(
    '',
    `The links can be used again, like the printed QR codes. More links: npm run demo -- --links --dir ${h.dir}`,
  );
  L.push('On another address of this machine, replace the host part of a link.');
  L.push('', '## What to try first');
  JOURNEYS.forEach((j, i) => L.push(`${i + 1}. ${j}`));
  L.push('', '## Good to know');
  if (h.scheme === 'https')
    L.push(
      '- The browser warns about the certificate once per device (it is self-signed): choose Advanced, then continue. Needed because browsers give the offline parts of the app only to secure addresses; plain http from another device shows the notice "Überblick braucht eine gesicherte Verbindung (https) …".',
    );
  L.push(
    '- The map has no internet basemap: it draws the features on a plain background, so the demo works offline.',
  );
  L.push(
    '- The map opens at the project\'s start view (Baumkataster: the whole town, so the trees show as one cluster): tap a cluster number to zoom in (or pinch, scroll), or use "Liste" and tap a row.',
  );
  L.push(
    '- Bernd (bauhof) works from "Zuletzt": a "Maßnahme" has no place on the map, so he finds it there ("Neu" twice).',
  );
  L.push(
    '- Known: Olga\'s "Aktivität" lists "Eingereicht" for work the applicants did (WP-710, being fixed).',
  );
  L.push(
    '- The projects start with sample data (imported and worked on through runs). Your clicks are kept across restarts.',
  );
  L.push(`- Start over with the sample data: npm run demo -- --reset --dir ${h.dir}`);
  L.push('- The server log is in the demo dir (server.log). Ctrl-C stops the demo.');
  return `${L.join('\n')}\n`;
}
