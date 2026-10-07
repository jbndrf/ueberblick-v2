/**
 * `ui.mjs seed`: prepares a fresh data directory for one golden project. It reuses the e2e seeding
 * (apps/web/e2e/seed.ts), so a journey starts from the same state as the e2e suite. Prints one JSON
 * line: {key, email, password, totp}. Usage: seed-run.ts <dataDir> <fixture>
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TemplateFile } from '@ueberblick/core';
import { openControlDb, publishTemplate } from '@ueberblick/server';
import { parse } from 'yaml';
import { seedControl } from '../../apps/web/e2e/seed';
import { embedRefs } from '../embed-refs.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [dataDir, fixture] = process.argv.slice(2);
if (dataDir === undefined || fixture === undefined) throw new Error('usage: seed-run.ts <dataDir> <fixture>');

const overlay = parse(readFileSync(`${ROOT}fixtures/golden/projects/${fixture}.yaml`, 'utf8')) as {
  extends: string;
};
const [base, major] = overlay.extends.split('@');
const key = fixture.replace(/[^a-z0-9]/g, '');
const seeded = await seedControl(dataDir, [key]);

// seedControl publishes baumkataster 1.0.0 only; any other base template of the fixture is added here.
if (base !== 'baumkataster') {
  const dir = `${ROOT}fixtures/golden/templates/${base}`;
  const file = readdirSync(dir)
    .filter((f) => f.startsWith(`${major}.`))
    .sort()
    .pop();
  if (file === undefined) throw new Error(`no template ${overlay.extends} under ${dir}`);
  const control = openControlDb(`${dataDir}/control.db`);
  const tpl = embedRefs(parse(readFileSync(`${dir}/${file}`, 'utf8')), ROOT) as TemplateFile;
  const now = new Date().toISOString();
  if (!publishTemplate(control, tpl, { now: () => now }).ok)
    throw new Error(`template ${base} did not publish`);
  control.close();
}
process.stdout.write(
  `${JSON.stringify({ key, email: seeded.email, password: seeded.password, totp: seeded.totp() })}\n`,
);
