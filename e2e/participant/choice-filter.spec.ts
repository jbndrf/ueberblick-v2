import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  base32Decode,
  createAuth,
  importParticipant,
  openControlDb,
  openProjectDb,
  totpAt,
} from '@ueberblick/server';
import { parse } from 'yaml';
import { embedRefs } from '../../scripts/embed-refs.mjs';
import { PARTICIPANT_DATA_DIR } from './playwright.config';
import { ROOT, TEMPLATE, qrLink, seedWorld, signInApi } from './world';

/**
 * WP-392 (E-25, ODK choice_filter): the participant form offers a dependent select. Project `auswahl` holds the golden tree
 * cadastre with two more select properties on the tree and the task "Befund ergänzen" asking for them: "Sorte" offers
 * only the varieties of the chosen "Gruppe" and explains one of them under its option (v3 Smart Dropdown, answer plus
 * explanation text). Run at phone (390x844) and desktop (1280x800) size.
 */
const KEY = 'auswahl';
const PERSON = 'participant-auswahl';
const RUN = '00000000-0000-7000-8000-000000000392';

function template(): unknown {
  const file = embedRefs(parse(readFileSync(TEMPLATE, 'utf8')), ROOT) as {
    views: Record<string, { camera?: unknown }>;
    types: {
      baum: { properties: Record<string, unknown>; permissions: { write: Record<string, string[]> } };
    };
    tasks: { befund_ergaenzen: { form: Record<string, unknown> } };
  };
  // the list shows the features of the map extent: look at the seeded tree
  (file.views['karte'] as { camera?: unknown }).camera = { center: [7.1, 50.7], zoom: 15 };
  const baum = file.types.baum;
  baum.properties['gruppe'] = {
    type: 'select',
    label: { de: 'Gruppe', en: 'Group' },
    options: { laub: 'Laubbaum', nadel: 'Nadelbaum' },
  };
  baum.properties['sorte'] = {
    type: 'select',
    label: { de: 'Sorte', en: 'Variety' },
    options: { eiche: 'Eiche', linde: 'Linde', kiefer: 'Kiefer' },
    option_hints: { linde: { de: 'Tilia cordata', en: 'Tilia cordata' } },
  };
  baum.permissions.write['gruppe'] = ['kontrolle', 'bauhof'];
  baum.permissions.write['sorte'] = ['kontrolle', 'bauhof'];
  file.tasks.befund_ergaenzen.form['gruppe'] = {};
  file.tasks.befund_ergaenzen.form['sorte'] = {
    choice_filter: "form.gruppe == 'laub' ? option != 'kiefer' : option == 'kiefer'",
  };
  return file;
}

let token = '';
test.beforeAll(async ({ playwright, baseURL }) => {
  await seedWorld(playwright, baseURL ?? '');
  const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
  // A failed test restarts the worker and runs `beforeAll` again on the same server: the project is already there.
  if (control.prepare('SELECT 1 AS x FROM projects WHERE key = ?').get(KEY) !== undefined) {
    control.close();
    return;
  }
  const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
  control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run(`id-${KEY}`, KEY, KEY, new Date().toISOString());
  const account = await auth.createAdmin('wp392@example.org', 'correct horse battery');
  control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(account, `id-${KEY}`, 'verwaltung');
  const { secret } = auth.enrolTotp(account);
  if (!auth.verifyTotp(account, totpAt(base32Decode(secret), Date.now()))) throw new Error('TOTP enrolment');
  token = auth.issueCredential(`id-${KEY}`, PERSON).token;
  const project = openProjectDb(PARTICIPANT_DATA_DIR, KEY);
  const added = importParticipant(
    { db: project, now: () => new Date() },
    { id: PERSON, name: 'Carla', roles: ['kontrolle'] },
  );
  project.close();
  control.close();
  if (!added.ok) throw new Error(`roster: ${added.code}`);

  const admin = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const login = await admin.post('/api/auth/login', {
    data: {
      email: 'wp392@example.org',
      password: 'correct horse battery',
      totp: totpAt(base32Decode(secret), Date.now() + 30_000),
    },
  });
  if (login.status() !== 200) throw new Error(`admin login failed: ${login.status()}`);
  const deploy = await admin.post(`/api/admin/p/${KEY}/deploy`, { data: template() });
  if (!((await deploy.json()) as { ok?: boolean }).ok) throw new Error('deploy failed');
  await admin.dispose();

  const api = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  await signInApi(api, token);
  const run = await api.post(`/api/p/${KEY}/runs`, {
    data: {
      id: RUN,
      task: 'erfassen',
      configVersion: 1,
      input: { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, vitalitaet: 'v2' },
    },
  });
  if (run.status() !== 200) throw new Error(`seeding the tree failed: ${run.status()} ${await run.text()}`);
  await api.dispose();
});

async function openForm(page: Page): Promise<void> {
  const control = openControlDb(`${PARTICIPANT_DATA_DIR}/control.db`);
  const fresh = createAuth({ control, now: () => new Date(), participantRoles: () => [] }).issueCredential(
    `id-${KEY}`,
    PERSON,
  ).token;
  control.close();
  await page.goto(qrLink(fresh));
  await expect(page).toHaveURL(/\/map$/);
  const toggle = page.getByRole('button', { name: 'List', exact: true });
  // the map is drawn here: the list is the keyboard way to the tree; retry the tap until the app is interactive
  await expect(async () => {
    if ((await toggle.count()) > 0) await toggle.click();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  const row = page.getByRole('table').getByRole('cell').first().getByRole('button');
  await expect(row).toBeVisible();
  await row.click();
  await page.getByRole('button', { name: 'Add finding' }).click();
  await expect(page.getByRole('textbox', { name: 'Finding' })).toBeVisible();
}

for (const [name, viewport] of [
  ['phone 390x844', { width: 390, height: 844 }],
  ['desktop 1280x800', { width: 1280, height: 800 }],
] as const) {
  test.describe(name, () => {
    test.use({ viewport });

    test('the dependent select offers the options of the chosen group, with the explanation under an option', async ({
      page,
    }) => {
      await openForm(page);
      await page.getByRole('button', { name: /Group/ }).click();
      await page.getByText('Laubbaum', { exact: true }).click();
      // phone: the select sheet closes with "Done"; desktop: the dropdown closes on pick
      const done = page.getByRole('button', { name: 'Done' });
      if ((await done.count()) > 0) await done.click();

      await page.getByRole('button', { name: /Variety/ }).click();
      await expect(page.getByText('Eiche', { exact: true })).toBeVisible();
      await expect(page.getByText('Linde', { exact: true })).toBeVisible();
      await expect(page.getByText('Tilia cordata')).toBeVisible();
      await expect(page.getByText('Kiefer', { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    });
  });
}
