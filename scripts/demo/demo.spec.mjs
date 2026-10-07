// WP-920: `npm run demo` against a temp data dir on free ports, with --no-build. It needs the web build
// (npm run build -w @ueberblick/web); without it the spec is skipped with a message. One seed takes about a minute,
// so the flows share three starts: first, restart without --reset, and --reset.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { freePort } from '../ui/seed.mjs';
import { lanAddresses } from './handout.mjs';
import { stopChildren, waitPortFree } from './teardown.mjs';
import { BUILD_COMMAND, isStale } from '../ops/web-build.mjs';

// the demo's certificate is self-signed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEMO = join(ROOT, 'scripts/demo/demo.mjs');
const built = !isStale();
if (!built) console.warn(`demo.spec skipped: the web build is missing or stale (${BUILD_COMMAND})`);
const plan = JSON.parse(readFileSync(join(ROOT, 'scripts/demo/plan.json'), 'utf8'));
const SLOW = 240_000;

const dir = mkdtempSync(join(tmpdir(), 'ub-demo-'));
let ports;
const started = [];
// A failed assertion must not leave a demo (and its app) running, or the next case dies on EADDRINUSE (WP-962):
// after every case stop what is still up, by pid, and wait until the port is free.
afterEach(async () => {
  await stopChildren(started);
  if (ports) await waitPortFree(ports.app);
});
afterAll(async () => {
  await stopChildren(started);
  rmSync(dir, { recursive: true, force: true });
});

/** Starts the demo and resolves when it printed DEMO READY. */
function start(...flags) {
  const child = spawn(
    process.execPath,
    [DEMO, '--no-build', '--dir', dir, '--port', String(ports.app), ...flags],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: specEnv() },
  );
  started.push(child);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const ready = new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (!out.includes('DEMO READY')) return;
      clearInterval(timer);
      resolve(undefined);
    }, 100);
    void exited.then((code) => {
      clearInterval(timer);
      reject(new Error(`demo exited ${code}:\n${out}`));
    });
  });
  return { child, ready, exited, output: () => out };
}

/** Ctrl-C: the demo must stop by itself, with exit code 0, and free its port. */
async function stop(run) {
  run.child.kill('SIGINT');
  expect(await run.exited).toBe(0);
  await expect(fetch(`${base()}/api/health`)).rejects.toThrow();
}

const db = (key) => new DatabaseSync(join(dir, `project-${key}.db`), { readOnly: true });
const one = (key, sql, ...args) => {
  const d = db(key);
  try {
    return d.prepare(sql).get(...args);
  } finally {
    d.close();
  }
};
const featureIds = (key) => {
  const d = db(key);
  try {
    return d
      .prepare('SELECT id, type FROM features ORDER BY id')
      .all()
      .map((r) => `${r.type}:${r.id}`);
  } finally {
    d.close();
  }
};
let scheme = 'https';
const base = () => `${scheme}://127.0.0.1:${ports.app}`;
const linksOf = (text) =>
  [...text.matchAll(/^- (\S+) \(([^)]*)\): https?:\/\/([^/]+)\/login\?token=(\S+)$/gm)].map((m) => ({
    name: m[1],
    roles: m[2],
    host: m[3],
    token: m[4],
  }));

async function exchange(origin, token) {
  const r = await fetch(`${origin}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const cookie = r.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  return { status: r.status, cookie };
}
const health = async (origin, cookie) =>
  (await fetch(`${origin}/api/health`, { headers: { cookie } })).json();

describe.skipIf(!built)('npm run demo', () => {
  const state = {};

  it(
    'seeds three projects and serves them: health, admin login, projects, at least 20 features each',
    async () => {
      ports = { app: await freePort() };
      const first = start();
      await first.ready;
      state.ids = Object.fromEntries(plan.projects.map((p) => [p.key, featureIds(p.key)]));
      state.handout = readFileSync(join(dir, 'DEMO.md'), 'utf8');

      expect(await health(base(), '')).toEqual({ ok: true, admin: null, participant: null });

      const noCode = spawnSync(process.execPath, [DEMO, '--totp', '--dir', dir], {
        encoding: 'utf8',
        env: specEnv(),
      });
      expect(noCode.status).toBe(1);
      expect(noCode.stderr).toContain('no one-time code');
      const creds = JSON.parse(readFileSync(join(dir, '.demo-seeded'), 'utf8'));
      const login = await fetch(`${base()}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
      });
      expect(login.status).toBe(200);
      const admin = login.headers.getSetCookie()[0].split(';')[0];
      expect((await health(base(), admin)).admin.kind).toBe('admin');

      expect(plan.projects.map((p) => p.key)).toHaveLength(3);
      for (const p of plan.projects) {
        const versions = await (
          await fetch(`${base()}/api/admin/p/${p.key}/versions`, { headers: { cookie: admin } })
        ).json();
        expect(versions.length, p.key).toBeGreaterThanOrEqual(1);
        expect(state.ids[p.key].length, p.key).toBeGreaterThanOrEqual(20);
      }

      // WP-994: the data lies at the project's own map start (when it has one: else the map fits the data), the
      // Baumkataster runs the newest 1.x of the corpus, and the "Baumart" lookup table has options.
      for (const p of plan.projects) {
        const row = one(
          p.key,
          'SELECT compiled, template_version AS tv FROM config_versions ORDER BY version DESC LIMIT 1',
        );
        const centre = JSON.parse(row.compiled).file.map?.start?.center;
        if (centre === undefined) {
          expect(p.key, 'the Baumkataster template has a map.start').not.toBe(plan.projects[0].key);
          continue;
        }
        const d = db(p.key);
        const geoms = d
          .prepare('SELECT anchor_lon AS x, anchor_lat AS y FROM features WHERE anchor_lon IS NOT NULL')
          .all();
        d.close();
        expect(geoms.length, p.key).toBeGreaterThan(0);
        for (const g of geoms) {
          const { x, y } = g;
          const km = Math.hypot(
            (x - centre[0]) * 111.32 * Math.cos((centre[1] * Math.PI) / 180),
            (y - centre[1]) * 110.54,
          );
          expect(km, `${p.key} feature`).toBeLessThan(5);
        }
      }
      const trees = plan.projects[0].key;
      expect(
        one(trees, 'SELECT template_version AS tv FROM config_versions ORDER BY version DESC LIMIT 1').tv,
      ).toBe('1.1.0');
      expect(
        one(trees, "SELECT count(*) AS n FROM features WHERE type = 'baumart'").n,
      ).toBeGreaterThanOrEqual(1);

      // The roles with their own lists have data: the melder reports and the handwerker work orders (WP-922), all
      // of them import runs.
      const own = (sql) => one('stadtwerke_meldungen', sql).n;
      expect(
        own(
          "SELECT count(*) AS n FROM features WHERE type = 'meldung' AND json_extract(properties, '$.melder') = 'mia'",
        ),
      ).toBeGreaterThanOrEqual(3);
      expect(
        own(
          "SELECT count(*) AS n FROM runs WHERE actor_kind = 'import' AND actor IN ('mia', 'import-demo') AND task IN ('melden', 'einsatz_anlegen')",
        ),
      ).toBeGreaterThanOrEqual(9 + 70); // the melder's and the work orders' import runs, besides the general import
      expect(
        own(
          "SELECT count(*) AS n FROM features WHERE type = 'einsatz' AND json_extract(properties, '$.zustaendig') = 'hanna'",
        ),
      ).toBeGreaterThanOrEqual(3);

      // The admin sign-in is the app's own page (WP-320): /builder is the admin project list (303 to /admin/projects),
      // which sends anonymous visitors to /admin/login (a page that loads); the session from the login API above
      // makes the sidebar list the three projects.
      const anonymous = await fetch(`${base()}/builder`, { redirect: 'manual' });
      expect(anonymous.status).toBe(303);
      expect(anonymous.headers.get('location')).toBe('/admin/projects');
      const signedOut = await fetch(`${base()}/admin/projects`, { redirect: 'manual' });
      expect(signedOut.headers.get('location')).toContain('/admin/login');
      expect((await fetch(`${base()}/admin/login`)).status).toBe(200);
      const list = await fetch(`${base()}/admin/projects`, { headers: { cookie: admin } });
      expect(list.status).toBe(200);
      const html = await list.text();
      // Each project appears as a link into it (the project cards link to its Teilnehmende page, WP-323); which
      // sub-page a link names is the page's business, not this spec's.
      for (const p of plan.projects) expect(html, p.key).toContain(`/admin/projects/${p.key}/`);
      await stop(first);
    },
    SLOW,
  );

  it(
    'a second start without --reset keeps the data, and every participant link signs in (also on a LAN address)',
    async () => {
      const project = plan.projects[0].key;
      const feature = one(project, "SELECT id FROM features WHERE type = 'baum' ORDER BY id LIMIT 1").id;
      const version = one(project, 'SELECT max(version) AS v FROM config_versions').v;
      const before = one(project, 'SELECT count(*) AS n FROM runs').n;
      const second = start();
      await second.ready;
      // a run made after the first start, through the API as Anna
      const runId = crypto.randomUUID();
      const anna = linksOf(readFileSync(join(dir, 'DEMO.md'), 'utf8')).find((l) => l.name === 'Anna');
      const session = await exchange(base(), anna.token);
      expect(session.status).toBe(200);
      const run = await fetch(`${base()}/api/p/${project}/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: session.cookie },
        body: JSON.stringify({
          id: runId,
          task: 'befund_ergaenzen',
          configVersion: version,
          featureId: feature,
          input: { befund: 'Nach dem Start' },
        }),
      });
      expect((await run.json()).outcome).toBe('accepted');
      await stop(second);

      const third = start();
      await third.ready;
      expect(one(project, 'SELECT count(*) AS n FROM runs WHERE id = ?', runId).n).toBe(1);
      expect(one(project, 'SELECT count(*) AS n FROM runs').n).toBeGreaterThan(before);
      expect(third.output()).toContain('Reusing');

      // every participant of every project: a fresh link exchanges to a signed-in participant session
      const links = spawnSync(process.execPath, [DEMO, '--links', '--dir', dir], {
        encoding: 'utf8',
        env: specEnv(),
      }).stdout;
      const tokens = [...links.matchAll(/^(\S+) (\S+) \(([^)]*)\): \/login\?token=(\S+)$/gm)];
      expect(tokens).toHaveLength(9);
      const own = { Mia: ['meldung', 'melder', 'mia'], Hanna: ['einsatz', 'zustaendig', 'hanna'] };
      for (const [, key, name, , token] of tokens) {
        const s = await exchange(base(), token);
        expect(s.status, `${key} ${name}`).toBe(200);
        const who = (await health(base(), s.cookie)).participant;
        expect(who.kind).toBe('participant');
        expect(who.projectId).toBe(`id-${key}`);
        // What the participant's own list reads (WP-594: features without a position count): the melder and the
        // handwerker each get at least 3 of their own features through the server's read path, and only theirs.
        const [type, prop, id] = own[name] ?? [];
        if (key !== 'stadtwerke_meldungen' || type === undefined) continue;
        const res = await fetch(`${base()}/api/p/${key}/ogc/collections/${type}/items?limit=100`, {
          headers: { cookie: s.cookie },
        });
        const page = await res.json();
        expect(page.features.length, name).toBeGreaterThanOrEqual(3);
        // row level `visible_when` clips to their own; a property the role may not read is left out of the row
        for (const f of page.features) expect(f.properties[prop] ?? id, name).toBe(id);
      }

      // sign-in from a non-loopback address (the machine's LAN IP), when the machine has one
      const lan = lanAddresses()[0];
      if (lan === undefined) console.warn('no non-loopback IPv4 address: LAN sign-in not tested');
      else {
        const extra = spawnSync(process.execPath, [DEMO, '--links', '--dir', dir], {
          encoding: 'utf8',
          env: specEnv(),
        }).stdout;
        const token = /^\S+ Vera \([^)]*\): \/login\?token=(\S+)$/m.exec(extra)[1];
        const origin = `https://${lan}:${ports.app}`;
        const s = await exchange(origin, token);
        expect(s.status).toBe(200);
        expect((await health(origin, s.cookie)).participant.kind).toBe('participant');
        expect((await fetch(`${origin}/admin/login`)).status).toBe(200);
      }
      await stop(third);
    },
    SLOW,
  );

  it(
    '--http serves plain http without a certificate, with cookies that work over http',
    async () => {
      const plain = start('--http');
      await plain.ready;
      scheme = 'http';
      const link = /^\S+ Anna \([^)]*\): \/login\?token=(\S+)$/m.exec(
        spawnSync(process.execPath, [DEMO, '--links', '--dir', dir], { encoding: 'utf8', env: specEnv() })
          .stdout,
      )[1];
      const s = await exchange(base(), link);
      expect(s.status).toBe(200);
      expect((await fetch(`${base()}/api/health`, { headers: { cookie: s.cookie } })).ok).toBe(true);
      expect((await health(base(), s.cookie)).participant.kind).toBe('participant');
      await stop(plain);
      scheme = 'https';
    },
    SLOW,
  );

  it(
    '--reset wipes the dir and gives the same seeded state: same feature ids and counts',
    async () => {
      const project = plan.projects[0].key;
      const fourth = start('--reset');
      await fourth.ready;
      for (const p of plan.projects) expect(featureIds(p.key), p.key).toEqual(state.ids[p.key]);
      expect(one(project, "SELECT count(*) AS n FROM runs WHERE task = 'befund_ergaenzen'").n).toBe(0);
      await stop(fourth);
    },
    SLOW,
  );

  it('the handout names every participant, the warning and the basemap fact', () => {
    const links = linksOf(state.handout);
    expect(links).toHaveLength(9);
    expect(state.handout).toContain('DEMO ONLY');
    expect(state.handout).toContain('no internet basemap');
    expect(state.handout).toContain('/admin ');
    expect(state.handout).not.toContain('__demo');
    expect(state.handout).toContain('/map');
  });
});
