import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../playwright.config';
import { rosterToken } from '../seed';

/**
 * WP-751: the world of the form journeys on the built app. A small own template (`formreise@1`) with one tree type
 * and the tasks the journeys need: a paged form with required fields, a form whose field hides another stored one,
 * a task that is only a quick edit, and a task with three steps. One tree exists, with every value filled.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const FORM_KEY = 'formreisestadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const EMAIL = 'formreise@example.org';
const TREE_RUN = '00000000-0000-7000-8000-0000000751a1';
export const TREE_AT: readonly [number, number] = [10.4515, 51.1657];

const label = (de: string): { de: string } => ({ de });
const roleApp = { home: 'karte', views: { karte: {} }, tools: {}, shortcuts: {} };

export const FORM_TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'formreise', version: '1.0.0' },
  map: {
    start: { center: [...TREE_AT], zoom: 16 },
    layers: {
      osm: {
        label: label('Straßenkarte'),
        kind: 'base',
        source: { type: 'preset', preset: 'osm' },
        on_at_start: true,
      },
    },
  },
  roles: {
    kontrolle: { label: label('Kontrolle'), app: roleApp },
    verwaltung: { label: label('Verwaltung'), app: roleApp },
  },
  types: {
    baum: {
      label: label('Baum'),
      geometry: 'geometrie',
      permissions: { see: '$all', create: ['kontrolle'], write: ['kontrolle'] },
      marker: { color: '#2f855a', icon: { key: 'tree-deciduous' } },
      properties: {
        geometrie: { type: 'geometry', geometry_type: 'point', required: true, label: label('Standort') },
        titel: { type: 'text', label: label('Titel') },
        hoehe: { type: 'number', min: 0, label: label('Höhe') },
        befund: { type: 'text', label: label('Befund') },
        typ: { type: 'select', options: { a: label('Typ A'), b: label('Typ B') }, label: label('Typ') },
        detail: { type: 'text', label: label('Detail') },
        notiz: { type: 'text', label: label('Notiz') },
      },
    },
  },
  tasks: {
    erfassen: {
      label: label('Baum erfassen'),
      on: '$map',
      creates: 'baum',
      who: ['kontrolle'],
      form: {
        geometrie: { tool: 'draw', required: true },
        titel: {},
        typ: {},
        detail: {},
        notiz: {},
      },
    },
    pruefung: {
      label: label('Prüfung'),
      on: 'baum',
      who: ['kontrolle'],
      form: {
        titel: { required: true, page: { label: label('Allgemein') } },
        hoehe: {},
        befund: { required: true, page: { label: label('Befund') } },
      },
    },
    bewertung: {
      label: label('Bewertung'),
      on: 'baum',
      who: ['kontrolle'],
      form: {
        typ: { calculate: 'self.typ' },
        detail: { relevant: "form.typ == 'a'", calculate: 'self.detail' },
      },
    },
    stammdaten: {
      label: label('Stammdaten'),
      on: 'baum',
      who: ['kontrolle'],
      steps: [{ kind: 'quick_edit', properties: ['titel', 'notiz'] }],
      button: { label: label('Bearbeiten'), color: 'neutral', icon: 'pencil' },
    },
    mehrstufig: {
      label: label('Mehrstufig'),
      on: 'baum',
      who: ['kontrolle'],
      form: { befund: {} },
      steps: [
        { kind: 'form' },
        { kind: 'quick_edit', properties: ['titel'] },
        { kind: 'quick_edit', properties: ['notiz'] },
      ],
    },
  },
  views: { karte: { label: label('Karte'), source: { type: 'baum' } } },
  tools: { draw: {} },
};

function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout + r.stderr };
}

/** Creates the project, publishes and deploys `formreise@1`, and records one tree with every value filled. */
export async function seedFormWorld(playwright: PlaywrightWorkerArgs['playwright']): Promise<void> {
  // a restarted worker (after a failure) finds the world there
  if (admin(['create-project', FORM_KEY, FORM_KEY]).status !== 0) return;
  const baseURL = `http://localhost:${E2E_PORT}`;
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, FORM_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-formreise-')), 'formreise.json');
  writeFileSync(file, JSON.stringify(FORM_TEMPLATE));
  const published = admin(['publish-template', file]);
  expect(published.status, published.out).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${FORM_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'formreise@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', { data: { token: fieldToken() } });
  const r = await field.post(`/api/p/${FORM_KEY}/runs`, {
    data: {
      id: TREE_RUN,
      task: 'erfassen',
      configVersion: 1,
      input: {
        geometrie: { type: 'Point', coordinates: [...TREE_AT] },
        titel: 'Linde',
        typ: 'a',
        detail: 'Pilz',
        notiz: 'Ast lose',
      },
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  await field.dispose();
}

/** A fresh sign-in link token of a field participant (role kontrolle). */
export const fieldToken = (id = 'p-field'): string => rosterToken(E2E_DATA_DIR, FORM_KEY, id, ['kontrolle']);

/** How many runs of a task the server has accepted. */
export function acceptedRuns(task: string): number {
  const db = openProjectDb(E2E_DATA_DIR, FORM_KEY);
  try {
    return (
      db
        .prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE task = ? AND outcome = 'accepted'")
        .get(task)?.n ?? 0
    );
  } finally {
    db.close();
  }
}

/** The stored properties of the one tree, as the server's current state holds them. */
export function treeProps(): Record<string, unknown> {
  const db = openProjectDb(E2E_DATA_DIR, FORM_KEY);
  try {
    const row = db
      .prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'baum' LIMIT 1")
      .get();
    return JSON.parse(row?.properties ?? '{}') as Record<string, unknown>;
  } finally {
    db.close();
  }
}

let counter = 0;
/** Sets the tree back to its seeded values (typ A with a detail, titel and notiz) through runs of the field participant. */
export async function resetTree(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string,
): Promise<void> {
  const db = openProjectDb(E2E_DATA_DIR, FORM_KEY);
  const tree = db.prepare<{ id: string }>("SELECT id FROM features WHERE type = 'baum' LIMIT 1").get();
  db.close();
  const api = await playwright.request.newContext({ baseURL });
  await api.post('/api/auth/exchange', { data: { token: fieldToken('p-reset') } });
  const send = async (task: string, input: Record<string, unknown>): Promise<void> => {
    const id = `00000000-0000-7000-8000-${String((Date.now() % 1e9) * 1000 + counter++).padStart(12, '0')}`;
    const r = await api.post(`/api/p/${FORM_KEY}/runs`, {
      data: { id, task, configVersion: 1, featureId: tree?.id, input },
    });
    expect(r.status(), await r.text()).toBe(200);
  };
  await send('bewertung', { typ: 'a', detail: 'Pilz' });
  await send('stammdaten', { titel: 'Linde', notiz: 'Ast lose' });
  await api.dispose();
}
