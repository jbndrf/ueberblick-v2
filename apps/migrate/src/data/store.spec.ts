/** WP-170: the migration store is the runtime's composition, so timers of migrated features are scheduled. */
import { describe, expect, it } from 'vitest';
import { compile, NO_ASSETS, type TemplateFile } from '@ueberblick/core';
import {
  createLogger,
  createProjectServices,
  deployProject,
  openProjectDb,
  type Db,
} from '@ueberblick/server';
import { convertConfig, type ImportTarget } from '../config';
import { loadFixture } from '../config/testing';
import { migrationStore, readDataExport, runMigration } from './index';
import { CLOCK, loadData } from './testing';

const converted = convertConfig(loadFixture('baumkontrolle') as never, { target: 'import' });
const plain = converted.target;
if (plain === undefined) throw new Error('no import target');

/** The import target plus a system task with an `elapsed` automatic action on the date property `kontrolldatum` of `baum`. */
function withRule(target: ImportTarget): ImportTarget {
  const file = {
    ...target.file,
    tasks: {
      ...target.file.tasks,
      pruefen: {
        label: 'Pruefen',
        on: 'baum',
        when: "actor.kind == 'system'",
        then: [{ set: { besichtigt: "'ja'" } }],
        auto: { faellig: { elapsed: { from: 'self.kontrolldatum' } } },
      },
    },
  } as unknown as TemplateFile;
  const r = compile(file, { assets: NO_ASSETS });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return { ...target, file, config: r.config };
}

/** The converted project (what the cutover deploys) plus the same system task and `elapsed` rule. */
const projectWithRule = (): TemplateFile => {
  const t = converted.template as unknown as TemplateFile;
  return {
    ...t,
    tasks: {
      ...t.tasks,
      pruefen: {
        label: 'Pruefen',
        on: 'baum',
        when: "actor.kind == 'system'",
        then: [{ set: { besichtigt: "'ja'" } }],
        auto: { faellig: { elapsed: { from: 'self.kontrolldatum' } } },
      },
    },
  } as unknown as TemplateFile;
};

const timers = (db: Db): number =>
  db.prepare<{ n: number }>('SELECT count(*) AS n FROM timers').get()?.n ?? 0;

async function importInto(db: Db, target: ImportTarget): Promise<void> {
  const { store, geo, configVersion } = migrationStore(db, target, CLOCK);
  const r = await runMigration(store, readDataExport(loadData('baumkontrolle')), converted.mapping, {
    target,
    geo,
    configVersion,
  });
  expect(r.accepted).toBeGreaterThan(0);
}

describe('migrationStore', () => {
  it('schedules the elapsed timers of migrated features while the import runs', async () => {
    const db = openProjectDb(':memory:', 'test');
    await importInto(db, withRule(plain));
    expect(timers(db)).toBeGreaterThan(0);
  });

  it('an import project without rules leaves no timers (the real file deploys afterwards and rebuilds them)', async () => {
    const db = openProjectDb(':memory:', 'test');
    await importInto(db, plain);
    expect(timers(db)).toBe(0);
  });

  it('production path: after an import without rules, deploying the real project through deployProject rebuilds the timers', async () => {
    const db = openProjectDb(':memory:', 'test');
    await importInto(db, plain);
    expect(timers(db)).toBe(0);
    const services = createProjectServices({
      clock: CLOCK,
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      projectDb: () => db,
      store: () => {
        throw new Error('nothing fires in this test');
      },
    });
    const r = deployProject(db, projectWithRule(), 'cutover', {
      clock: CLOCK,
      afterDeploy: () => services.afterDeploy('test'),
    });
    expect(r).toMatchObject({ ok: true });
    const baeume = db
      .prepare<{ n: number }>(
        "SELECT count(*) AS n FROM features WHERE type = 'baum' AND lifecycle IN ('active','completed')",
      )
      .get()?.n;
    expect(baeume).toBeGreaterThan(0);
    // One row per migrated baum that has a `kontrolldatum`.
    const withDate = db
      .prepare<{ n: number }>(
        "SELECT count(*) AS n FROM features WHERE type = 'baum' AND lifecycle IN ('active','completed') AND json_extract(properties, '$.kontrolldatum') IS NOT NULL",
      )
      .get()?.n;
    expect(withDate).toBeGreaterThan(0);
    expect(timers(db)).toBe(withDate);
  });
});
