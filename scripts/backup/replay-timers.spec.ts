// WP-170: replay composes the store with the timers hook, so a replayed run leaves the same derived timer rows
// the runtime would. Nothing fires: no loop starts during a replay.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { serialize, type TemplateFile } from '@ueberblick/core';
import { openSqlite } from '../../packages/server/src/db/driver';
import { openControlDb } from '../../packages/server/src/db/open';
import { build, setup } from '../../packages/server/src/store/run/testkit';
import { eraseRun, erasureTemplate, root } from '../../packages/server/src/store/run/erasure.testkit';
import { exportJournal } from './journal.mjs';
import { replayProject } from './replay.mjs';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ub-replay-timers-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The erasure template where an erasure run also stamps `gilt_bis` (in the past) on the `loeschung` it creates, and an elapsed automatic action reads it. */
function template(): TemplateFile {
  const t = erasureTemplate() as unknown as Record<string, Record<string, Record<string, unknown>>>;
  const types = t.types as Record<string, { properties: Record<string, unknown> }>;
  const tasks = t.tasks as Record<string, { then: unknown[] }>;
  return {
    ...t,
    types: {
      ...types,
      loeschung: {
        ...types.loeschung,
        properties: { ...types.loeschung?.properties, gilt_bis: { type: 'date' } },
      },
    },
    tasks: {
      ...tasks,
      erase_subject: {
        ...tasks.erase_subject,
        then: [{ set: { gilt_bis: "date('2020-01-01')" } }, ...(tasks.erase_subject?.then ?? [])],
      },
      pruefen: {
        label: 'Pruefen',
        on: 'loeschung',
        then: [],
        auto: { faellig: { elapsed: { from: 'self.gilt_bis' } } },
      },
    },
  } as unknown as TemplateFile;
}

it('a replayed erasure run leaves the timer rows the runtime would, and nothing fires', () => {
  const c = setup({ config: build(template()) });
  c.db
    .prepare(`UPDATE config_versions SET compiled = ? WHERE version = 1`)
    .run(JSON.stringify(serialize(c.config)));
  const report = c.store.submit(
    c.run('melden', { id: 'anna', kind: 'participant', roles: ['melder'] } as never, { telefon: '0151 1' }),
  );
  expect(report.outcome).toBe('accepted');
  const snap = tmp();
  c.db.exec(`VACUUM INTO '${join(snap, 'project-baum.db')}'`);
  const run = eraseRun(c, 'anna', root);
  expect(c.store.submit(run).outcome).toBe('accepted');
  const live = tmp();
  openControlDb(join(live, 'control.db')).close();
  c.db.exec(`VACUUM INTO '${join(live, 'project-baum.db')}'`);
  const entry = exportJournal(live).projects['project-baum.db'];
  if (entry === undefined) throw new Error('no journal entry');
  mkdirSync(snap, { recursive: true });

  const path = join(snap, 'project-baum.db');
  const db = openSqlite(path);
  expect(db.prepare('SELECT count(*) AS n FROM timers').get()).toEqual({ n: 0 });
  db.close();

  const r = replayProject(path, entry, { clock: { now: () => '2026-10-01T09:00:00.000Z' } });
  expect(r.replayed).toBe(1);
  const after = openSqlite(path);
  const created = after.prepare('SELECT id FROM features WHERE type = ?').all('loeschung') as {
    id: string;
  }[];
  expect(created).toHaveLength(1);
  expect(after.prepare('SELECT feature_id, rule, due_at FROM timers').all()).toEqual([
    { feature_id: created[0]?.id, rule: 'pruefen.faellig', due_at: '2020-01-01T00:00:00.000Z' },
  ]);
  // The row is long due, yet no system run exists: replay starts no timers loop.
  expect(after.prepare("SELECT count(*) AS n FROM runs WHERE actor_kind = 'system'").get()).toEqual({ n: 0 });
  after.close();
});
