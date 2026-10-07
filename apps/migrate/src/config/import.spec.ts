/** WP-149: the converter emits the import tasks itself; `target: 'import'` leaves the rules out. */
import { listAutos } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { convertConfig } from './convert';
import { FIXTURES, loadFixture } from './testing';

const IMPORT_ONLY = ['import'];

describe.each(FIXTURES)('import tasks of %s', (name) => {
  const v3 = loadFixture(name);
  const plain = convertConfig(v3);
  const imp = convertConfig(v3, { target: 'import' });

  it('emits a form on the create task and the update task, both for the actor kind import only', () => {
    const tasks = plain.template.tasks ?? {};
    const types = plain.template.types ?? {};
    // the erasure type (WP-172) is not a v3 type: it has no import tasks
    expect(Object.keys(plain.imports)).toEqual(Object.keys(types).filter((k) => k !== 'erasure'));
    for (const [type, t] of Object.entries(plain.imports)) {
      const props = Object.keys(types[type]?.properties ?? {});
      expect(tasks[t.create]).toMatchObject({ on: '$none', who: IMPORT_ONLY, creates: type });
      expect(tasks[t.update]).toMatchObject({ on: type, who: IMPORT_ONLY });
      expect(Object.keys(tasks[t.create]?.form ?? {})).toEqual(props);
      expect(Object.keys(tasks[t.update]?.form ?? {})).toEqual(props);
    }
  });

  it('leaves the automatic actions out for the import target only', () => {
    expect(listAutos(imp.template)).toEqual([]);
    expect(imp.target).toBeDefined();
    if (imp.target !== undefined) expect(listAutos(imp.target.file)).toEqual([]);
    expect(imp.target?.tasks).toEqual(imp.imports);
    expect(imp.check.ok).toBe(true);
    expect(plain.target).toBeUndefined();
  });

  it('widens nothing: the import tasks stay for the actor kind import, no other task changed', () => {
    const before = plain.template.tasks ?? {};
    const own = new Set(Object.values(imp.imports).flatMap((t) => [t.create, t.update]));
    for (const [k, task] of Object.entries(imp.template.tasks ?? {})) {
      if (own.has(k)) expect(task.who).toEqual(IMPORT_ONLY);
      else expect(task).toEqual({ ...before[k], auto: undefined });
    }
  });
});
