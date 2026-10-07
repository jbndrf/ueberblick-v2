import { describe, expect, it } from 'vitest';
import { CREATE_TASK, type Key } from '@ueberblick/core';
import { importFile, planImport } from './import';
import { count, importSetup } from './testkit';
import type { ImportMapping } from './contract';

// A Tabelle (WP-433, owner A8): the same CSV wizard, but each row is a `$create` run of the type, the way an admin adds a row.
const TABLE: ImportMapping = {
  task: CREATE_TASK as Key,
  type: 'baumart' as Key,
  fields: { name_de: 'Name', name_lat: 'Latein' },
};
const CSV = (rows: string[]): string => ['Name;Latein', ...rows].join('\n');

const names = (ctx: ReturnType<typeof importSetup>['ctx']): string[] =>
  ctx.db
    .prepare<{ properties: string }>("SELECT properties FROM features WHERE type = 'baumart' ORDER BY rowid")
    .all()
    .map((r) => (JSON.parse(r.properties) as { name_de: string }).name_de);

describe('CSV import into a Tabelle', () => {
  it('writes each row as one $create run', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(
      ctx.store,
      { format: 'csv', data: CSV(['Eiche;Quercus', 'Buche;Fagus', 'Linde;Tilia']) },
      TABLE,
      deps,
    );
    expect(r).toMatchObject({ outcome: 'accepted', imported: 3 });
    expect(names(ctx)).toEqual(['Eiche', 'Buche', 'Linde']);
    const tasks = ctx.db.prepare<{ task: string }>('SELECT DISTINCT task FROM runs').all();
    expect(tasks).toEqual([{ task: CREATE_TASK }]);
  });

  it('the dry run plans a $create run per row, with the type and the values', () => {
    const { deps } = importSetup();
    const p = planImport({ format: 'csv', data: CSV(['Eiche;Quercus']) }, TABLE, deps, { mode: 'skip' });
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0]).toMatchObject({
      task: CREATE_TASK,
      actor: { kind: 'admin' },
      input: { type: 'baumart', values: { name_de: 'Eiche', name_lat: 'Quercus' } },
    });
  });

  it('atomic refuses everything when a row is refused, and writes nothing', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(ctx.store, { format: 'csv', data: CSV(['Eiche;Quercus', ';Fagus']) }, TABLE, deps);
    expect(r.outcome).toBe('refused');
    expect(r).toMatchObject({ problems: [{ row: 2, code: 'required_missing' }] });
    expect(count(ctx, 'features')).toBe(0);
  });

  it('skip mode reports the bad row and imports the rest', () => {
    const { ctx, deps } = importSetup();
    const r = importFile(
      ctx.store,
      { format: 'csv', data: CSV(['Eiche;Quercus', ';Fagus', 'Linde;Tilia']) },
      TABLE,
      deps,
      { mode: 'skip' },
    );
    expect(r).toMatchObject({ outcome: 'accepted', imported: 2 });
    expect(r.problems.map((p) => p.row)).toEqual([2]);
    expect(names(ctx)).toEqual(['Eiche', 'Linde']);
  });

  it('refuses a column that is not a property of the type', () => {
    const { deps } = importSetup();
    const p = planImport(
      { format: 'csv', data: CSV(['Eiche;Quercus']) },
      { ...TABLE, fields: { gibtsnicht: 'Name' } },
      deps,
    );
    expect(p.problems[0]).toMatchObject({ row: 0, code: 'mapping_invalid' });
  });

  it('has no geometry: a mapping that names one is refused', () => {
    const { deps } = importSetup();
    const p = planImport(
      { format: 'csv', data: CSV(['Eiche;Quercus']) },
      { ...TABLE, geometry: { field: 'g', x: 'Name', y: 'Latein' } },
      deps,
    );
    expect(p.problems[0]).toMatchObject({ row: 0, code: 'mapping_invalid' });
  });

  it('refuses a type that is not declared', () => {
    const { deps } = importSetup();
    const p = planImport({ format: 'csv', data: CSV(['a;b']) }, { ...TABLE, type: 'nix' as Key }, deps);
    expect(p.problems[0]).toMatchObject({ row: 0, code: 'mapping_invalid' });
  });
});
