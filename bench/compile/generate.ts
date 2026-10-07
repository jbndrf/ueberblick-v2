import type { TemplateFile } from '../../packages/core/src/schema/file';

/** A deterministic file with ~500 entities: 100 types, 250 tasks, 100 automatic actions and 50 views. */
export function generate(): TemplateFile {
  const types: Record<string, unknown> = {};
  const tasks: Record<string, unknown> = {};
  const views: Record<string, unknown> = {};
  for (let i = 0; i < 100; i++) {
    types[`typ_${i}`] = {
      label: `Typ ${i}`,
      geometry: 'point',
      properties: {
        stage: { type: 'select', options: { a: 'A', b: 'B', c: 'C' }, default: 'a' },
        wert: { type: 'integer' },
        name: { type: 'text' },
        faellig: { type: 'date' },
        zustaendig: { type: 'participant' },
      },
    };
  }
  for (let i = 0; i < 250; i++) {
    tasks[`task_${i}`] = {
      label: `Aufgabe ${i}`,
      on: `typ_${i % 100}`,
      when: "self.stage != 'c' && (self.wert == null || self.wert < 100) && !('x' in actor.roles)",
      form: {
        wert: { required: true, constraint: 'value >= 0 && value < 1000' },
        name: { relevant: 'form.wert > 3', calculate: "self.name + ''" },
        stage: {},
      },
      then: [
        { set: { faellig: 'today() + days(7)' }, when: 'form.wert > 10' },
        { set: { stage: "'b'" }, otherwise: true },
      ],
    };
  }
  for (let i = 0; i < 100; i++) {
    const run = tasks[`task_${i + 100}`] as { auto?: Record<string, unknown>; then: unknown[] };
    run.auto = { [`regel_${i}`]: { after: `task_${i}`, when: 'self.wert > 5' } };
    // An automatic run has no form: the required field gets its value from a then.set fallback (WP-1047, was `with`).
    run.then = [{ set: { wert: 'form.wert != null ? form.wert : 0' } }, ...run.then];
  }
  for (let i = 0; i < 50; i++) {
    views[`ansicht_${i}`] = {
      source: { type: `typ_${i}`, filter: "self.zustaendig == actor.id && self.stage == 'a'" },
      sort: ['faellig'],
    };
  }
  return {
    schema: 'ueberblick/1',
    template: { key: 'bench', version: '1.0.0' },
    roles: { r: { label: 'R' } },
    types,
    tasks,
    views,
  } as unknown as TemplateFile;
}
