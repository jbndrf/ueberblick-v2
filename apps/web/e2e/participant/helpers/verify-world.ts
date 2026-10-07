import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import { base32Decode, openProjectDb, totpAt } from '@ueberblick/server';
import { E2E_DATA_DIR, E2E_PORT } from '../../../playwright.config';
import { rosterToken } from '../../seed';

/**
 * WP-834: the world of the feature-sheet and map verify journeys. A small own template (`verifykarte@1`): a tree type
 * with a quick edit task, a move task, a classifying property (the cluster detail's rows) and a relation `defekte`
 * whose children sit at their parent (`inherit_position`); a child type with one task that is open work for the Kontrolle.
 * Each test plants its own trees through the field participant's runs (the API, the same path as the app).
 */
const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const VERIFY_KEY = 'verifykartestadt';
export const CENTER: readonly [number, number] = [10.4515, 51.1657];
export const CROWD = 8;
export const CROWD_GOOD = 5;
export const PASSWORD = 'correct horse battery';
export const STEP_MS = 30_000;
const EMAIL = 'verifykarte@example.org';
const label = (de: string): { de: string } => ({ de });
const roleApp = { home: 'karte', views: { karte: {} }, tools: {}, shortcuts: {} };

export const VERIFY_TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'verifykarte', version: '1.0.0' },
  map: {
    start: { center: [...CENTER], zoom: 10 },
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
      classify: {
        property: 'zustand',
        values: { gut: { color: '#2f855a' }, schwach: { color: '#c05621' } },
      },
      properties: {
        geometrie: { type: 'geometry', geometry_type: 'point', required: true, label: label('Standort') },
        titel: { type: 'text', required: true, label: label('Titel') },
        zustand: {
          type: 'select',
          options: { gut: label('Gut'), schwach: label('Schwach') },
          label: label('Zustand'),
        },
        hoehe: { type: 'number', min: 0, label: label('Höhe') },
        notiz: { type: 'text', label: label('Notiz') },
      },
      relations: {
        defekte: { to: 'defekt', inverse_of: 'defekt.baum', inherit_position: true, label: label('Defekte') },
      },
    },
    defekt: {
      label: label('Defekt'),
      permissions: { see: '$all', create: ['kontrolle'], write: ['kontrolle'] },
      process: { property: 'stage', start: 'offen', end: ['behoben'] },
      properties: {
        stage: {
          type: 'select',
          options: { offen: label('Offen'), behoben: label('Behoben') },
          label: label('Status'),
        },
        baum: { type: 'reference', to: 'baum', required: true, label: label('Baum') },
        beschreibung: { type: 'text', required: true, label: label('Beschreibung') },
        kommentar: { type: 'text', label: label('Kommentar') },
      },
    },
  },
  tasks: {
    erfassen: {
      label: label('Baum erfassen'),
      on: '$map',
      creates: 'baum',
      who: ['kontrolle'],
      form: { geometrie: { tool: 'draw', required: true }, titel: {}, zustand: {} },
    },
    stammdaten: {
      label: label('Bearbeiten'),
      on: 'baum',
      who: ['kontrolle'],
      steps: [{ kind: 'quick_edit', properties: ['notiz', 'hoehe'] }],
      button: { label: label('Bearbeiten'), color: 'neutral', icon: 'pencil' },
    },
    verschieben: {
      label: label('Verschieben'),
      on: 'baum',
      who: ['kontrolle'],
      form: { geometrie: { tool: 'draw', required: true } },
    },
    defekt_anlegen: {
      label: label('Defekt anlegen'),
      on: 'baum',
      creates: 'defekt',
      who: ['kontrolle'],
      form: { beschreibung: { required: true } },
      then: [{ set: { baum: 'self' } }],
    },
    defekt_beheben: {
      label: label('Defekt beheben'),
      on: 'defekt',
      who: ['kontrolle'],
      when: "self.stage != 'behoben'",
      form: { kommentar: {} },
      then: [{ set: { stage: "'behoben'" } }],
    },
  },
  views: { karte: { label: label('Karte'), source: { type: 'baum' } } },
  tools: { draw: {} },
};

export function admin(args: string[]): { status: number; out: string } {
  const r = spawnSync('npm', ['run', '--silent', 'admin', '--', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, UEBERBLICK_ADMIN_PASSWORD: PASSWORD },
  });
  return { status: r.status ?? -1, out: r.stdout + r.stderr };
}

/** Creates the project (once) and publishes and deploys `verifykarte@1`. */
async function seed(playwright: PlaywrightWorkerArgs['playwright'], baseURL: string): Promise<void> {
  if (admin(['create-project', VERIFY_KEY, VERIFY_KEY]).status !== 0) return; // a restarted worker finds it
  const created = admin(['create-admin', EMAIL]);
  const secret = base32Decode(
    new URL(/otpauth:\/\/\S+/.exec(created.out)?.[0] ?? '').searchParams.get('secret') ?? '',
  );
  expect(admin(['confirm-totp', EMAIL, totpAt(secret, Date.now())]).status).toBe(0);
  expect(admin(['add-membership', EMAIL, VERIFY_KEY, 'verwaltung']).status).toBe(0);
  const file = join(mkdtempSync(join(tmpdir(), 'ub-verifykarte-')), 'verifykarte.json');
  writeFileSync(file, JSON.stringify(VERIFY_TEMPLATE));
  const published = admin(['publish-template', file]);
  expect(published.status, published.out).toBe(0);
  const ctx = await playwright.request.newContext({ baseURL });
  const login = await ctx.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD, totp: totpAt(secret, Date.now() + STEP_MS) },
  });
  expect(login.status()).toBe(200);
  const deploy = await ctx.post(`/api/admin/p/${VERIFY_KEY}/deploy`, {
    data: { schema: 'ueberblick/1', extends: 'verifykarte@1' },
  });
  expect(await deploy.json(), published.out).toMatchObject({ ok: true });
  await ctx.dispose();
}

export interface VerifyWorld {
  /** Runs a task as a field participant (role kontrolle) and expects the server to accept it. */
  send(task: string, input: Record<string, unknown>, featureId?: string): Promise<void>;
  /** Plants a tree and returns its id. */
  plant(titel: string, at: readonly [number, number], extra?: Record<string, unknown>): Promise<string>;
  /** Makes sure the crowd of the cluster journey stands at the start view: five trees in zustand gut, three schwach. */
  crowd(): Promise<void>;
  /** Records a defect on a tree (a child that sits at its parent). */
  defect(tree: string, beschreibung: string): Promise<string>;
}

let counter = 0;
const uuid = (): string =>
  `00000000-0000-7000-8000-${String((Date.now() % 1e9) * 1000 + (counter++ % 1000)).padStart(12, '0')}`;

/** The id of the feature that a run created (read from the server's current state by a unique text). */
function featureByText(key: string, text: string): string {
  const db = openProjectDb(E2E_DATA_DIR, VERIFY_KEY);
  try {
    const row = db
      .prepare<{ id: string }>(`SELECT id FROM features WHERE json_extract(properties, '$.${key}') = ?`)
      .get(text);
    if (row === undefined) throw new Error(`no feature with ${key} = ${text}`);
    return row.id;
  } finally {
    db.close();
  }
}

export const fieldToken = (id: string): string => rosterToken(E2E_DATA_DIR, VERIFY_KEY, id, ['kontrolle']);

export const test = base.extend<object, { world: VerifyWorld }>({
  world: [
    async ({ playwright }, use) => {
      const baseURL = `http://localhost:${E2E_PORT}`;
      await seed(playwright, baseURL);
      const field: APIRequestContext = await playwright.request.newContext({ baseURL });
      await field.post('/api/auth/exchange', { data: { token: fieldToken('p-verify-seed') } });
      const send: VerifyWorld['send'] = async (task, input, featureId) => {
        const r = await field.post(`/api/p/${VERIFY_KEY}/runs`, {
          data: {
            id: uuid(),
            task,
            configVersion: 1,
            input,
            ...(featureId === undefined ? {} : { featureId }),
          },
        });
        expect(r.status(), await r.text()).toBe(200);
        expect(await r.json()).toMatchObject({ outcome: 'accepted' });
      };
      await use({
        send,
        async plant(titel, at, extra = {}) {
          const { notiz, hoehe, ...create } = extra;
          await send('erfassen', { geometrie: { type: 'Point', coordinates: [...at] }, titel, ...create });
          const id = featureByText('titel', titel);
          if (notiz !== undefined || hoehe !== undefined) await send('stammdaten', { notiz, hoehe }, id);
          return id;
        },
        async crowd() {
          const stands = ((): boolean => {
            try {
              featureByText('titel', 'Pulk-0');
              return true;
            } catch {
              return false;
            }
          })();
          if (stands) return;
          for (let i = 0; i < CROWD; i++)
            await send('erfassen', {
              geometrie: { type: 'Point', coordinates: [CENTER[0] + i * 0.0004, CENTER[1] + i * 0.0004] },
              titel: `Pulk-${i}`,
              zustand: i < CROWD_GOOD ? 'gut' : 'schwach',
            });
        },
        async defect(tree, beschreibung) {
          await send('defekt_anlegen', { beschreibung }, tree);
          return featureByText('beschreibung', beschreibung);
        },
      });
      await field.dispose();
    },
    { scope: 'worker' },
  ],
});

/** Signs in as `participant` (a participant of its own, so preferences and queue never reach another test) and waits for the map. */
export async function signInVerify(page: Page, participant: string): Promise<void> {
  await page.goto(`/login?token=${encodeURIComponent(fieldToken(participant))}`);
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByTestId('map').locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 });
}

/** Opens a feature by its name through the list and closes the list again, so the sheet shows. */
export async function openByName(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Liste' }).click();
  await page.getByRole('button', { name }).first().click();
  await page.getByRole('button', { name: 'Liste' }).click();
}

/** A unique text per test, size and repeat (the data directory outlives a repeat). */
export const unique = (
  what: string,
  size: string,
  info: { repeatEachIndex: number; retry: number },
): string => `${what}-${size}-${info.repeatEachIndex}-${info.retry}-${Date.now() % 100000}`;

/** How many runs of `task` the server accepted. */
export function acceptedRuns(task: string): number {
  const db = openProjectDb(E2E_DATA_DIR, VERIFY_KEY);
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

/** The stored properties of a feature, as the server's current state holds them. */
export function propsOf(id: string): Record<string, unknown> {
  const db = openProjectDb(E2E_DATA_DIR, VERIFY_KEY);
  try {
    const row = db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id);
    return JSON.parse(row?.properties ?? '{}') as Record<string, unknown>;
  } finally {
    db.close();
  }
}
