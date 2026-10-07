/**
 * The world of the map test (WP-592): project `karte` holds the golden tree cadastre with one change. The golden map
 * layers point at style files (`$ref`) that nothing resolves until WP-577, so the participant app would show the list
 * instead of a map. Here the map view carries an inline style and a camera, so the map is drawn for real.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Playwright } from '@playwright/test';
import { createAuth, importParticipant, openControlDb, openProjectDb } from '@ueberblick/server';
import { parse } from 'yaml';
import { PARTICIPANT_DATA_DIR } from './playwright.config';
import { MAP_PROJECT, ROOT, TEMPLATE, TREE_RUN, signInApi } from './world';
import { embedRefs } from '../../scripts/embed-refs.mjs';

export const MAP_PARTICIPANT = 'participant-map';
/** Where the map view's camera looks: the tree of the seeded run. */
export const CAMERA_CENTER: readonly [number, number] = [7.1, 50.7];
export const CAMERA_ZOOM = 15;
/** The finding of the seeded tree: what the Search test types. */
export const FINDING = 'Hohlraum im Stamm';

const style = {
  layers: [
    {
      id: 'ub-single',
      type: 'circle',
      source: 'ub-clusters',
      filter: ['!', ['has', 'clusterId']],
      paint: { 'circle-color': '#1b5e3b', 'circle-radius': 8 },
    },
  ],
};

/** The golden template with an inline layer style and a camera on its map view. */
export function mapTemplate(): unknown {
  const file = embedRefs(parse(readFileSync(TEMPLATE, 'utf8')), ROOT) as {
    views: Record<string, { layers: Record<string, { style: unknown }>; camera?: unknown }>;
    roles: Record<string, { app: { tools: Record<string, unknown> } }>;
    tasks: Record<string, { form: Record<string, unknown> }>;
  };
  const view = file.views['karte'];
  if (view === undefined) throw new Error('the golden template has no map view');
  // the tree is found by its finding (the golden `tools.search` source is `baum.befund`); the recording task has none
  const record = file.tasks['erfassen'];
  if (record === undefined) throw new Error('the golden template has no task erfassen');
  record.form['befund'] = {};
  // WP-655: Search is on for the role from the start, Measure is offered (off until the person switches it on)
  const kontrolle = file.roles['kontrolle'];
  if (kontrolle === undefined) throw new Error('the golden template has no role kontrolle');
  kontrolle.app.tools = { search: {}, measure: { availability: 'offered' }, chat: {} };
  // WP-684: the Projekt-Chat is declared by the project and on for role kontrolle (the participant)
  const tools = (file as unknown as { tools?: Record<string, unknown> }).tools ?? {};
  tools['chat'] = {};
  (file as unknown as { tools: Record<string, unknown> }).tools = tools;
  view.camera = { center: [...CAMERA_CENTER], zoom: CAMERA_ZOOM };
  // WP-621: a second base, an overlay for everyone and one only `verwaltung` sees (the participant is `kontrolle`)
  const layers = (file as unknown as { map: { layers: Record<string, unknown> } }).map.layers;
  layers['luft'] = {
    label: { de: 'Luftbild', en: 'Aerial' },
    kind: 'base',
    source: { type: 'xyz', url: 'https://tiles.invalid/{z}/{x}/{y}.jpg' },
  };
  layers['flur'] = {
    label: { de: 'Flurstücke', en: 'Parcels' },
    kind: 'overlay',
    source: { type: 'wms', url: 'https://wms.invalid/ows', layers: 'flur' },
  };
  layers['intern'] = {
    label: { de: 'Nur Verwaltung', en: 'Admin only' },
    kind: 'overlay',
    roles: ['verwaltung'],
    source: { type: 'geojson', url: '/intern.geojson' },
  };
  view.layers = { baeume: { ...view.layers['baeume'], style } as { style: unknown } };
  return file;
}

/** Deploys the map template to `karte` (as the signed-in admin), puts a participant on its roster and records one tree. Called by `seedWorld`. */
export async function seedMapWorld(
  playwright: Playwright,
  baseURL: string,
  admin: APIRequestContext,
): Promise<void> {
  const project = openProjectDb(PARTICIPANT_DATA_DIR, MAP_PROJECT);
  // the roster generates ids (WP-310); the credential below names this one, so import it under it
  const added = importParticipant(
    { db: project, now: () => new Date() },
    { id: MAP_PARTICIPANT, name: 'Berta', roles: ['kontrolle'] },
  );
  project.close();
  if (!added.ok) throw new Error(`roster: ${added.code}`);

  const deploy = await admin.post(`/api/admin/p/${MAP_PROJECT}/deploy`, { data: mapTemplate() });
  if (!((await deploy.json()) as { ok?: boolean }).ok) throw new Error('map template deploy failed');

  const token = mapToken();
  const participant = await playwright.request.newContext({ baseURL });
  await signInApi(participant, token);
  const run = await participant.post(`/api/p/${MAP_PROJECT}/runs`, {
    data: {
      id: TREE_RUN,
      task: 'erfassen',
      configVersion: 1,
      input: {
        geometrie: { type: 'Point', coordinates: [...CAMERA_CENTER] },
        vitalitaet: 'v2',
        befund: FINDING,
      },
    },
  });
  if (run.status() !== 200) throw new Error(`seeding the tree failed: ${run.status()} ${await run.text()}`);
  await participant.dispose();
}

/** A fresh one-time QR token for the map project's participant. */
export function mapToken(): string {
  const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
  try {
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    return auth.issueCredential(`id-${MAP_PROJECT}`, MAP_PARTICIPANT).token;
  } finally {
    control.close();
  }
}
