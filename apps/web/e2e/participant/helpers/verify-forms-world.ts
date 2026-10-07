import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type PlaywrightWorkerArgs } from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../../playwright.config';
import { rosterToken } from '../../seed';

/**
 * WP-833: the world of the step-2 form verification (p3 rows: validation, show_if, clearing guard, input per type,
 * prefill, computed, task without form). A small own template (`verifyforms@1`, a test fixture, no demo template) with one
 * tree type that has a property of every input kind, and one task per row. One tree exists; `resetTree` puts it back.
 */
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const VERIFY_KEY = 'verifyformsstadt';
const PASSWORD = 'correct horse battery';
const STEP_MS = 30_000;
const EMAIL = 'verifyforms@example.org';
export const TREE_AT: readonly [number, number] = [10.4515, 51.1657];

const label = (de: string): { de: string } => ({ de });
const roleApp = { home: 'karte', views: { karte: {} }, tools: {}, shortcuts: {} };
const ALL = ['kontrolle'];
const W = Object.fromEntries(
  [
    'geometrie',
    'stage',
    'titel',
    'hoehe',
    'anzahl',
    'aktiv',
    'datum',
    'zeit',
    'art',
    'tags',
    'notiz',
    'mail',
    'kurz',
    'detail',
    'kennung',
    'am',
    'befund',
  ].map((k) => [k, ALL]),
);

export const VERIFY_TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'verifyforms', version: '1.0.0' },
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
      permissions: { see: '$all', create: ALL, write: W },
      process: { property: 'stage', start: 'offen', end: ['erledigt'] },
      marker: { color: '#2f855a', icon: { key: 'tree-deciduous' } },
      properties: {
        geometrie: { type: 'geometry', geometry_type: 'point', required: true, label: label('Standort') },
        stage: {
          type: 'select',
          label: label('Status'),
          options: { offen: label('Offen'), erledigt: label('Erledigt') },
        },
        titel: { type: 'text', label: label('Titel') },
        titel_gross: { type: 'text', label: label('Titel gross'), computed: 'self.titel.upper()' },
        hoehe: { type: 'number', min: 0, max: 100, label: label('Höhe') },
        anzahl: { type: 'integer', label: label('Anzahl') },
        aktiv: { type: 'boolean', label: label('Aktiv') },
        datum: { type: 'date', label: label('Datum') },
        zeit: { type: 'datetime', label: label('Zeitpunkt') },
        art: { type: 'select', options: { a: label('Art A'), b: label('Art B') }, label: label('Art') },
        tags: {
          type: 'multiselect',
          options: { x: label('Eins'), y: label('Zwei') },
          label: label('Merkmale'),
        },
        notiz: { type: 'text', label: label('Notiz') },
        mail: { type: 'text', label: label('E-Mail') },
        kurz: { type: 'text', label: label('Kürzel') },
        detail: { type: 'text', label: label('Detail') },
        kennung: { type: 'text', label: label('Kennung') },
        am: { type: 'date', label: label('Erfasst am') },
        befund: { type: 'text', label: label('Befund') },
      },
    },
  },
  tasks: {
    erfassen: {
      label: label('Baum erfassen'),
      on: '$map',
      creates: 'baum',
      who: ['kontrolle'],
      form: { geometrie: { tool: 'draw', required: true }, titel: {} },
    },
    pruefung: {
      label: label('Prüfung'),
      on: 'baum',
      who: ['kontrolle'],
      form: {
        titel: { required: true },
        hoehe: {},
        anzahl: {},
        kurz: {
          constraint: 'size(value) >= 3 && size(value) <= 8',
          constraint_message: label('Kürzel braucht 3 bis 8 Zeichen'),
        },
        mail: {
          appearance: 'email',
          constraint: "value.matches('^[^@ ]+@[^@ ]+\\\\.[a-z]+$')",
          constraint_message: label('E-Mail ist keine gültige Adresse'),
        },
      },
    },
    typen: {
      label: label('Alle Eingaben'),
      on: 'baum',
      who: ['kontrolle'],
      form: {
        titel: {},
        hoehe: {},
        anzahl: {},
        aktiv: {},
        datum: {},
        zeit: {},
        art: {},
        tags: {},
        notiz: { appearance: 'multiline' },
        mail: { appearance: 'email' },
      },
    },
    bedingt: {
      label: label('Bedingt'),
      on: 'baum',
      who: ['kontrolle'],
      form: {
        art: { calculate: 'self.art' },
        detail: { relevant: "form.art == 'a'", calculate: 'self.detail' },
      },
    },
    vorbelegung: {
      label: label('Vorbelegung'),
      on: 'baum',
      who: ['kontrolle'],
      form: {
        titel: { calculate: 'self.titel' },
        kennung: { calculate: "'K-7'" },
        am: { calculate: 'today()' },
        befund: {},
      },
    },
    berechnung: {
      label: label('Berechnung'),
      on: 'baum',
      who: ['kontrolle'],
      form: { titel: {}, titel_gross: {} },
    },
    abschliessen: {
      label: label('Abschließen'),
      on: 'baum',
      who: ['kontrolle'],
      when: "self.stage != 'erledigt'",
      then: [{ set: { stage: "'erledigt'" } }],
    },
    zuruecksetzen: {
      label: label('Zurücksetzen'),
      on: 'baum',
      who: ['kontrolle'],
      form: Object.fromEntries(
        [
          'titel',
          'hoehe',
          'anzahl',
          'aktiv',
          'datum',
          'zeit',
          'art',
          'tags',
          'notiz',
          'mail',
          'kurz',
          'detail',
          'kennung',
          'am',
          'befund',
        ].map((k) => [k, {}]),
      ),
      then: [{ set: { stage: "'offen'" } }],
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

const baseURL = `http://localhost:${E2E_PORT}`;
/** A sign-in token of a field participant (role kontrolle). */
export const verifyToken = (id = 'p-field'): string =>
  rosterToken(E2E_DATA_DIR, VERIFY_KEY, id, ['kontrolle']);

/** Creates the project, deploys `verifyforms@1` and records one tree. */
export async function seedVerifyWorld(playwright: PlaywrightWorkerArgs['playwright']): Promise<void> {
  if (admin(['create-project', VERIFY_KEY, VERIFY_KEY]).status !== 0) return; // a restarted worker finds it there
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, VERIFY_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-verifyforms-')), 'verifyforms.json');
  writeFileSync(file, JSON.stringify(VERIFY_TEMPLATE));
  const published = admin(['publish-template', file]);
  expect(published.status, published.out).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${VERIFY_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'verifyforms@1' },
  });
  expect(await deploy.json()).toMatchObject({ ok: true });
  await ctx.dispose();
  const field = await playwright.request.newContext({ baseURL });
  await field.post('/api/auth/exchange', { data: { token: verifyToken('p-seed') } });
  const r = await field.post(`/api/p/${VERIFY_KEY}/runs`, {
    data: {
      id: '00000000-0000-7000-8000-0000000833a1',
      task: 'erfassen',
      configVersion: 1,
      input: { geometrie: { type: 'Point', coordinates: [...TREE_AT] } },
    },
  });
  expect(r.status(), await r.text()).toBe(200);
  await field.dispose();
}

let counter = 0;
/** Puts the tree back: stage offen, titel "Linde", art A with a detail, everything else empty. */
export async function resetTree(playwright: PlaywrightWorkerArgs['playwright']): Promise<void> {
  const tree = openDb((db) =>
    db.prepare<{ id: string }>("SELECT id FROM features WHERE type = 'baum' LIMIT 1").get(),
  );
  const api = await playwright.request.newContext({ baseURL });
  await api.post('/api/auth/exchange', { data: { token: verifyToken('p-reset') } });
  const input = {
    titel: 'Linde',
    art: 'a',
    detail: 'Pilz',
    hoehe: null,
    anzahl: null,
    aktiv: null,
    datum: null,
    zeit: null,
    tags: null,
    notiz: null,
    mail: null,
    kurz: null,
    kennung: null,
    am: null,
    befund: null,
  };
  const id = `00000000-0000-7000-8000-${String((Date.now() % 1e9) * 1000 + counter++).padStart(12, '0')}`;
  const r = await api.post(`/api/p/${VERIFY_KEY}/runs`, {
    data: { id, task: 'zuruecksetzen', configVersion: 1, featureId: tree?.id, input },
  });
  expect(r.status(), await r.text()).toBe(200);
  await api.dispose();
}

function openDb<T>(read: (db: ReturnType<typeof openProjectDb>) => T): T {
  const db = openProjectDb(E2E_DATA_DIR, VERIFY_KEY);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** How many runs of a task the server has accepted. */
export const acceptedRuns = (task: string): number =>
  openDb(
    (db) =>
      db
        .prepare<{ n: number }>("SELECT count(*) AS n FROM runs WHERE task = ? AND outcome = 'accepted'")
        .get(task)?.n ?? 0,
  );

/** The stored properties of the one tree. */
export const treeProps = (): Record<string, unknown> =>
  JSON.parse(
    openDb((db) =>
      db.prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'baum' LIMIT 1").get(),
    )?.properties ?? '{}',
  ) as Record<string, unknown>;
