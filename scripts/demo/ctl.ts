/**
 * The demo's side that needs the server's TypeScript: `demo.mjs` runs it as a child process, like `scripts/ui/seed-run.ts`.
 *   ctl.ts seed <dir>      control.db: the three projects, the admin, templates, rosters. Prints {"email","password"}.
 *   ctl.ts session <dir>   an admin session for the deploy of the seed (no sign-in form). Prints {"name","value"}.
 *   ctl.ts populate <dir>  sample data as runs (the projects must be deployed first).
 *   ctl.ts links <dir>     a fresh one-time QR token per participant. Prints [{project, id, name, roles, token}].
 *   ctl.ts totp <dir>      the next admin code that the server will accept. Prints {"code","waitMs"}, or {"enrolled":false}
 *                          when the admin has no TOTP (the demo and dev seeds turn it off).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TemplateFile } from '@ueberblick/core';
import {
  base32Decode,
  createAuth,
  importParticipant,
  openControlDb,
  openProjectDb,
  publishTemplate,
  sessionCookie,
  totpAt,
  type Db,
} from '@ueberblick/server';
import { parse } from 'yaml';
import { rosterToken, seedControl } from '../../apps/web/e2e/seed';
import plan from './plan.json' with { type: 'json' };
import { populate } from './populate';
import { embedRefs } from '../embed-refs.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [command, dir] = process.argv.slice(2);
if (command === undefined || dir === undefined)
  throw new Error('usage: ctl.ts <seed|populate|links|totp|session> <dir>');

const out = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);
const keys = plan.projects.map((p) => p.key);

/** The newest template of the major a golden project extends, published into control.db. */
function publishBase(control: Db, fixture: string): void {
  const overlay = parse(readFileSync(`${ROOT}fixtures/golden/projects/${fixture}.yaml`, 'utf8')) as {
    extends: string;
  };
  const [base, major] = overlay.extends.split('@') as [string, string];
  const tplDir = `${ROOT}fixtures/golden/templates/${base}`;
  const file = readdirSync(tplDir)
    .filter((f) => f.startsWith(`${major}.`))
    .sort()
    .pop();
  if (file === undefined) throw new Error(`no template ${overlay.extends}`);
  const tpl = embedRefs(parse(readFileSync(`${tplDir}/${file}`, 'utf8')), ROOT) as TemplateFile;
  if (!publishTemplate(control, tpl, { now: () => new Date().toISOString() }).ok)
    throw new Error(`template ${base} did not publish`);
}

async function seed(): Promise<void> {
  // seedControl makes the admin (admin@example.org), the first project and participant-1 of it; the rest is added here.
  const seeded = await seedControl(dir as string, keys, { totp: false });
  const control = openControlDb(`${dir}/control.db`);
  for (const p of plan.projects) publishBase(control, p.fixture);
  // The project row's name is what the participant header shows when the template has no branding name.
  const rename = control.prepare('UPDATE projects SET name = ? WHERE key = ?');
  for (const p of plan.projects) rename.run(p.name, p.key);
  control.close();
  // The roster row carries the plan's name (rosterToken adds a nameless row, so the named one goes in first).
  for (const p of plan.projects) {
    const project = openProjectDb(dir as string, p.key);
    try {
      for (const who of p.participants) {
        const added = importParticipant({ db: project, now: () => new Date() }, who);
        if (!added.ok && added.code !== 'participant_exists')
          throw new Error(`roster ${who.id}: ${added.code}`);
      }
    } finally {
      project.close();
    }
    for (const who of p.participants) rosterToken(dir as string, p.key, who.id, who.roles);
  }
  out({ email: seeded.email, password: seeded.password });
}

/** The seeding deploys as the admin without the sign-in form, so it does not depend on how the admin signs in. */
function session(): void {
  const control = openControlDb(`${dir}/control.db`);
  try {
    const row = control.prepare<{ id: string }>('SELECT id FROM accounts LIMIT 1').get();
    if (row === undefined) throw new Error('no admin account: seed first');
    const auth = createAuth({ control, now: () => new Date(), participantRoles: () => [] });
    const [pair = ''] = sessionCookie('admin', auth.openAdminSession(row.id)).split(';');
    const i = pair.indexOf('=');
    out({ name: pair.slice(0, i), value: pair.slice(i + 1) });
  } finally {
    control.close();
  }
}

function links(): void {
  out(
    plan.projects.flatMap((p) =>
      p.participants.map((who) => ({
        project: p.key,
        id: who.id,
        name: who.name,
        roles: who.roles,
        token: rosterToken(dir as string, p.key, who.id, who.roles),
      })),
    ),
  );
}

/** Each code is single use and the server accepts a step of the last one or newer, within one step of now. */
function totp(): void {
  const control = openControlDb(`${dir}/control.db`);
  const row = control.prepare<{ mfa: string | null }>('SELECT mfa FROM accounts LIMIT 1').get();
  control.close();
  const state = JSON.parse(row?.mfa ?? 'null') as { secret: string; lastStep: number } | null;
  if (state === null) return out({ enrolled: false });
  const period = 30_000; // auth/params.ts TOTP_PARAMS.periodSeconds (not exported)
  const now = Date.now();
  const step = Math.max(Math.floor(now / period), state.lastStep + 1);
  const waitMs = Math.max(0, (step - 1) * period - now);
  out({ code: totpAt(base32Decode(state.secret), step * period), waitMs });
}

if (command === 'seed') await seed();
else if (command === 'populate') {
  for (const key of keys) populate(dir, key);
  out({ populated: keys });
} else if (command === 'links') links();
else if (command === 'totp') totp();
else if (command === 'session') session();
else throw new Error(`unknown command ${command}`);
