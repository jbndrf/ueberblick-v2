import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Key, RunId } from '@ueberblick/core';
import {
  authorizeProject,
  DEVICE_KINDS,
  createBlobs,
  createLogger,
  deploy,
  isAuthError,
  projectStoresFor,
  sessionCookie,
} from '@ueberblick/server';
import { createChatHandlers } from '@ueberblick/server';
import { createRuntime, type Runtime } from './runtime';
import { embedGoldenRefs } from '@ueberblick/core/testing';

const template = embedGoldenRefs(
  parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ),
  ),
) as Parameters<typeof deploy>[1];

const dirs: string[] = [];
const runtimes: Runtime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world(intervalMs: number | null = 30_000) {
  const lines: string[] = [];
  const created = { n: 0 };
  const dir = mkdtempSync(join(tmpdir(), 'ub-runtime-'));
  dirs.push(dir);
  const time = { at: new Date('2026-03-01T08:00:00.000Z') };
  const beats: { fn: (() => void) | undefined; stopped: boolean } = { fn: undefined, stopped: false };
  const rt = createRuntime({
    dataDir: dir,
    secureCookies: false,
    ...(intervalMs === null ? {} : { timersIntervalMs: intervalMs }),
    now: () => time.at,
    sink: (l) => lines.push(l),
    makeLogger: (o) => {
      created.n += 1;
      return createLogger(o);
    },
    every: (fn) => {
      beats.fn = fn;
      return () => {
        beats.stopped = true;
        beats.fn = undefined;
      };
    },
  });
  runtimes.push(rt);
  rt.control
    .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
    .run('p1', 'demo', 'demo', 'x');
  return { rt, time, beats, lines, created, dir };
}

const run = (n: number) => ({
  id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as RunId,
  task: 'erfassen' as Key,
  actor: { id: 'anna', kind: 'participant' as const, roles: ['kontrolle' as Key] },
  configVersion: 1,
  input: { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, vitalitaet: 'v2' },
});

describe('runtime wiring (WP-137)', () => {
  it('a project has one store; its runs schedule timers, ring the bell, and the loop fires them', () => {
    const { rt, time, beats } = world();
    const db = rt.projectDb('demo');
    deploy(db, template, 'admin', { clock: rt.clock });
    const store = projectStoresFor(rt)('demo');
    expect(projectStoresFor(rt)('demo')).toBe(store);

    const heard: number[] = [];
    rt.doorbell('demo').subscribe((m) => heard.push(m.to));
    expect(store.submit(run(1)).outcome).toBe('accepted');
    expect(heard).toHaveLength(1); // the doorbell of this runtime, at once
    expect(db.prepare<{ n: number }>('SELECT count(*) n FROM timers').get()?.n).toBe(1);

    time.at = new Date('2029-01-01T00:00:00.000Z');
    beats.fn?.(); // the loop's beat
    expect(heard).toHaveLength(2); // the fired rule run rang the bell too
    expect(db.prepare<{ n: number }>('SELECT count(*) n FROM timers').get()?.n).toBe(0);
    const flag = db
      .prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'baum'")
      .get();
    expect(JSON.parse(flag?.properties ?? '{}')).toMatchObject({ kontrolle_faellig: true });
  });

  it('stop ends the loop; a runtime without an interval never starts one', () => {
    const w = world();
    expect(w.beats.stopped).toBe(false);
    w.rt.stop();
    w.rt.stop();
    expect(w.beats.stopped).toBe(true);
    const none = world(null);
    expect(none.beats.fn).toBeUndefined();
    const zero = world(0);
    expect(zero.beats.fn).toBeUndefined();
  });

  it('lists the projects it ticks', () => {
    const { rt } = world();
    expect(rt.projectKeys()).toEqual(['demo']);
  });
});

/** A tiny project: a personal photo and the task that erases a participant (A-021). */
const erasureTemplate = {
  schema: 'ueberblick/1',
  template: { key: 'erasure_demo', version: '1.0.0' },
  roles: { melder: { label: 'Melder' } },
  types: {
    meldung: {
      label: 'Meldung',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { foto: { type: 'file', personal: { subject: 'actor' } } },
    },
    loeschung: {
      label: 'Loeschung',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { subject: { type: 'participant' } },
    },
  },
  tasks: {
    melden: { label: 'Melden', who: ['melder'], on: '$none', creates: 'meldung', form: { foto: {} } },
    erase_subject: {
      label: 'Erase',
      on: '$none',
      who: ['admin'],
      creates: 'loeschung',
      form: { subject: { required: true } },
      then: [{ redact: { subject: 'actor', of: 'form.subject' } }],
    },
  },
} as unknown as Parameters<typeof deploy>[1];

describe('erasure through the runtime (A-021)', () => {
  it('a run of the erasure task deletes the blob bytes under the data dir', async () => {
    const { rt } = world();
    const db = rt.projectDb('demo');
    deploy(db, erasureTemplate, 'admin', { clock: rt.clock });
    const { sha256 } = await createBlobs({ db, store: rt.blobs.store('demo'), clock: rt.clock }).put(
      (async function* () {
        yield Buffer.from('personal photo');
      })(),
      'image/jpeg',
    );
    const store = projectStoresFor(rt)('demo');
    const q = "INSERT INTO blob_uploads VALUES (?, 'anna', 'participant', 'x')";
    db.prepare(q).run(sha256);
    const anna = { id: 'anna', kind: 'participant' as const, roles: ['melder' as Key] };
    const id = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}` as RunId;
    const report = { id: id(1), task: 'melden' as Key, actor: anna, configVersion: 1 };
    expect(
      store.submit({ ...report, input: { foto: [{ sha256, name: 'a.jpg', mime: 'image/jpeg' }] } }).outcome,
    ).toBe('accepted');
    expect(rt.blobs.store('demo').has(sha256)).toBe(true);

    const erase = {
      id: id(2),
      task: 'erase_subject' as Key,
      actor: { id: 'root', kind: 'admin' as const, roles: [] },
      configVersion: 1,
      input: { subject: 'anna' },
    };
    expect(store.submit(erase).outcome).toBe('accepted');
    expect(rt.blobs.store('demo').has(sha256)).toBe(false);
  });
});

describe('the process logger (WP-155)', () => {
  const NEVER = '0 0 31 2 *';
  const full = template as unknown as { tasks: object };
  const withNever = {
    ...template,
    tasks: {
      ...full.tasks,
      nachtlauf: { label: 'N', on: '$none', auto: { nie: { schedule: NEVER } } },
    },
  } as unknown as Parameters<typeof deploy>[1];

  it('one logger per runtime; a timer.dropped reaches the sink as one JSON line without values', () => {
    const { rt, lines, created } = world();
    deploy(rt.projectDb('demo'), withNever, 'admin', { clock: rt.clock });
    rt.services.afterDeploy('demo');
    expect(created.n).toBe(1);
    expect(rt.log).toBe(rt.log);
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(line).toEqual({
      t: Date.parse('2026-03-01T08:00:00.000Z'),
      level: 'warn',
      event: 'timer.dropped',
      ruleId: 'nachtlauf.nie',
      code: 'schedule_never_runs',
    });
  });

  it('a failed blob delete is an error line with codes only', () => {
    const { rt, lines } = world();
    rt.blobs.onError('demo', new Error('/data/secret-path/photo.jpg'));
    const e = JSON.parse(lines[0] ?? '') as Record<string, unknown>;
    expect(e).toMatchObject({ level: 'error', event: 'blob.delete_failed', projectKey: 'demo' });
    expect(lines.join('')).not.toContain('secret-path');
  });
});

describe('preview isolation (WP-340, A-031)', () => {
  const PREVIEW = 'demo__vorschau';

  function withPreview() {
    const w = world();
    const preview = w.rt.ensurePreview('p1');
    // a preview participant, with a login whose project id is the preview's id
    w.rt
      .projectDb(PREVIEW)
      .prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)')
      .run('tester', 'Tester', '["kontrolle"]');
    w.rt.control
      .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
      .run('PREV-TOKEN', preview.id, 'tester');
    w.rt
      .projectDb('demo')
      .prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)')
      .run('anna', 'Anna', '["kontrolle"]');
    w.rt.control
      .prepare('INSERT INTO credentials (token, project_id, participant_id) VALUES (?,?,?)')
      .run('REAL-TOKEN', 'p1', 'anna');
    return { ...w, preview };
  }
  const cookieFor = (rt: Runtime, token: string): Request => {
    const s = rt.auth.exchange(token);
    if (isAuthError(s)) throw new Error(`exchange failed: ${s.code}`);
    return new Request('http://x/', { headers: { cookie: sessionCookie('participant', s) } });
  };
  const status = (r: unknown): number | undefined => (r instanceof Response ? r.status : undefined);

  it('rt.project knows only real projects; rt.participantProject resolves both', () => {
    const { rt, preview } = withPreview();
    expect(preview).toMatchObject({ key: PREVIEW });
    expect(rt.project(PREVIEW)).toBeUndefined();
    expect(rt.participantProject('demo')).toEqual({ id: 'p1', key: 'demo' });
    expect(rt.participantProject(PREVIEW)).toEqual({ id: preview.id, key: PREVIEW });
    expect(rt.participantProject('other__vorschau')).toBeUndefined();
    expect(rt.projectDb(PREVIEW)).not.toBe(rt.projectDb('demo'));
  });

  it('participantProjectOf resolves a session project id: the real one, or the live preview with its project name', () => {
    const { rt, preview } = withPreview();
    expect(rt.participantProjectOf('p1')).toEqual({ id: 'p1', key: 'demo', name: 'demo' });
    expect(rt.participantProjectOf(preview.id)).toEqual({ id: preview.id, key: PREVIEW, name: 'demo' });
    expect(rt.participantProjectOf('nope')).toBeUndefined();
    rt.dropPreview('p1');
    expect(rt.participantProjectOf(preview.id)).toBeUndefined();
  });

  it('the preview database is its own file; no project-*__vorschau.db is ever created', () => {
    const { dir } = withPreview();
    const files = readdirSync(dir);
    expect(files).toContain('preview-demo.db');
    expect(files.filter((f) => f.startsWith('project-') && f.includes('__'))).toEqual([]);
  });

  it('every listing and every project resolver stays blind to the preview', () => {
    const { rt, preview } = withPreview();
    expect(rt.projectKeys()).toEqual(['demo']); // timers, admin lists, exports
    expect(rt.project(PREVIEW)).toBeUndefined(); // OGC, MCP, runs, sync, blobs, exports, admin
    expect(rt.control.prepare<{ key: string }>('SELECT key FROM projects ORDER BY key').all()).toEqual([
      { key: 'demo' },
    ]); // erasure, export-subject
    expect(rt.auth.rolesFor('any-admin', preview.id)).toEqual([]); // admin access
  });

  it('authorizeProject over rt (what OGC, MCP, runs, sync and blobs use) refuses the preview key for every session', () => {
    const { rt } = withPreview();
    for (const token of ['REAL-TOKEN', 'PREV-TOKEN'])
      expect(status(authorizeProject(rt, cookieFor(rt, token), PREVIEW, DEVICE_KINDS))).toBe(403);
    expect(status(authorizeProject(rt, cookieFor(rt, 'PREV-TOKEN'), 'demo', DEVICE_KINDS))).toBe(403);
    expect(status(authorizeProject(rt, cookieFor(rt, 'REAL-TOKEN'), 'demo', DEVICE_KINDS))).toBeUndefined();
  });

  it('on the participant resolver a preview session reaches only the preview, a real one only the real project', () => {
    const { rt } = withPreview();
    const deps = { auth: rt.auth, project: rt.participantProject };
    const ok = authorizeProject(deps, cookieFor(rt, 'PREV-TOKEN'), PREVIEW, DEVICE_KINDS);
    expect(ok instanceof Response ? undefined : ok.actor).toMatchObject({
      id: 'tester',
      roles: ['kontrolle'],
    });
    expect(status(authorizeProject(deps, cookieFor(rt, 'PREV-TOKEN'), 'demo', DEVICE_KINDS))).toBe(403);
    expect(status(authorizeProject(deps, cookieFor(rt, 'REAL-TOKEN'), PREVIEW, DEVICE_KINDS))).toBe(403);
  });

  it('only runtime.ts, the registry and the participant wirings resolve previews: nothing else calls participantProject or reads previews', () => {
    const root = fileURLToPath(new URL('../../../../../', import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (!['node_modules', '.svelte-kit', 'build', 'dist'].includes(e.name)) walk(p);
        } else if (/\.(ts|svelte)$/.test(e.name) && !e.name.endsWith('.spec.ts')) {
          if (/participantProject|FROM previews/.test(readFileSync(p, 'utf8')))
            hits.push(p.slice(root.length));
        }
      }
    };
    walk(join(root, 'apps/web/src'));
    walk(join(root, 'packages/server/src'));
    // the participant routes' wirings (WP-341) are the only other resolvers; OGC, MCP, admin, export, builder keep `rt.project`
    expect(hits.sort()).toEqual([
      'apps/web/src/lib/server/runtime.ts',
      'apps/web/src/routes/(participant)/participant-api/wiring.ts',
      'apps/web/src/routes/api/p/[project]/sync/wiring.ts',
      'apps/web/src/routes/api/p/[project]/tools/wiring.ts',
      'apps/web/src/routes/api/p/[project]/wiring.ts',
      'packages/server/src/preview/registry.ts',
    ]);
  });

  it('the timers loop ticks a deployed preview as a second list: its due rule fires there, not in the project', () => {
    const { rt, time, beats } = world();
    rt.ensurePreview('p1');
    const pdb = rt.projectDb(PREVIEW);
    deploy(pdb, template, 'admin', { clock: rt.clock });
    expect(projectStoresFor(rt)(PREVIEW).submit(run(1)).outcome).toBe('accepted');
    expect(pdb.prepare<{ n: number }>('SELECT count(*) n FROM timers').get()?.n).toBe(1);
    time.at = new Date('2029-01-01T00:00:00.000Z');
    beats.fn?.();
    expect(pdb.prepare<{ n: number }>('SELECT count(*) n FROM timers').get()?.n).toBe(0);
    expect(rt.projectKeys()).toEqual(['demo']);
  });

  it('chat works in a preview: the tools wiring resolves it with participantProject, and the bell is the runtime one (A-031)', async () => {
    const { rt, preview } = withPreview();
    const file = structuredClone(template) as unknown as {
      tools?: object;
      roles?: Record<string, { app?: { tools?: object } }>;
    };
    file.tools = { chat: {} };
    for (const r of Object.values(file.roles ?? {})) if (r.app) delete r.app.tools;
    deploy(rt.projectDb(PREVIEW), file as unknown as Parameters<typeof deploy>[1], 'admin', {
      clock: rt.clock,
    });
    const rang: string[] = [];
    rt.services.toolBell.subscribe(PREVIEW, (t) => rang.push(t));
    const handlers = createChatHandlers({
      auth: rt.auth,
      project: (key) => rt.participantProject(key),
      clock: rt.clock,
      projectDb: (key) => rt.projectDb(key),
      deployed: (key) => rt.services.deployed(key),
      ringTool: (project, tool) => rt.services.toolBell.ring(project, tool),
    });
    const cookie = cookieFor(rt, 'PREV-TOKEN').headers.get('cookie') ?? '';
    const call = (h: 'send' | 'list', project: string, body?: unknown) =>
      handlers[h](
        new Request(`http://x/api/p/${project}/tools/chat`, {
          method: h === 'send' ? 'POST' : 'GET',
          headers: { cookie, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { params: { project, tool: 'chat' } },
      );
    expect(preview.key).toBe(PREVIEW);
    expect((await call('send', PREVIEW, { id: 'prev-msg-0001', body: 'Vorschau' })).status).toBe(201);
    expect(rang).toEqual(['chat']);
    expect((await call('list', PREVIEW)).status).toBe(200);
    expect((await call('list', 'demo')).status).toBe(404); // a preview login does not reach the real project
  });

  it('dropPreview closes the handle, removes the file and the preview stops resolving', () => {
    const { rt, preview, dir } = withPreview();
    rt.dropPreview('p1');
    expect(rt.participantProject(PREVIEW)).toBeUndefined();
    expect(() => rt.projectDb(PREVIEW)).toThrow(/unknown preview/);
    expect(readdirSync(dir)).not.toContain('preview-demo.db');
    expect(
      rt.control.prepare('SELECT 1 FROM credentials WHERE project_id = ?').get(preview.id),
    ).toBeUndefined();
    expect(rt.ensurePreview('p1')).toEqual(preview); // lazily re-created
    expect(rt.participantProject(PREVIEW)).toBeDefined();
  });
});
