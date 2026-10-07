// C-004 step 3: the rights derived from tasks (`who` + what the task writes) against today's `permissions`
// create/write/delete, over every golden template. The differences are listed and explained below.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { FeatureState, Key } from '../model';
import { compile } from '../schema/compile';
import type { CompiledConfig } from '../schema/compile/contract';
import { TemplateFileSchema } from '../schema/file';
import { goldenAssets } from '../testing/golden';
import { compilePerms, roleSubject } from './index';
import { deriveRights } from './derived';

const raw = import.meta.glob('/fixtures/golden/templates/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const compiled = Object.entries(raw).map(([path, text]): [string, CompiledConfig] => {
  const r = compile(TemplateFileSchema.parse(parse(text)), { assets: goldenAssets });
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(r.problems)}`);
  return [path.replace('/fixtures/golden/templates/', '').replace('.yaml', ''), r.config];
});

/** `<role> <action> <type>[.<property>]` for every right one side gives and the other does not. */
function compare(config: CompiledConfig): { today: string[]; derived: string[] } {
  const perms = compilePerms(config);
  const d = deriveRights(config);
  const roles = Object.keys(config.file.roles ?? {});
  const todayOnly: string[] = [];
  const derivedOnly: string[] = [];
  const stub = { id: 'x', type: '', properties: {} } as unknown as FeatureState;
  for (const [type, def] of Object.entries(config.file.types ?? {})) {
    const tp = perms.forType(type as Key);
    if (tp === undefined) continue;
    for (const role of roles) {
      const s = [roleSubject(role)];
      const eq = (what: string, today: boolean, derived: boolean): void => {
        if (today && !derived) todayOnly.push(`${role} ${what}`);
        if (derived && !today) derivedOnly.push(`${role} ${what}`);
      };
      eq(`create ${type}`, tp.canCreate(s).ok, d.create.get(type)?.has(role) === true);
      const ctx = { vars: new Map(), features: undefined } as never;
      eq(`delete ${type}`, tp.canDelete(s, stub, ctx).ok, d.delete.get(type)?.has(role) === true);
      for (const prop of Object.keys(def.properties))
        eq(
          `write ${type}.${prop}`,
          tp.canWrite(s, [prop]).ok,
          d.write.get(type)?.get(prop)?.has(role) === true,
        );
    }
  }
  return { today: todayOnly.sort(), derived: derivedOnly.sort() };
}

// Findings (WP-1047, reported to the lead): in no golden template does a task give a role a right that `permissions`
// refuses (`derived` is empty: the compile warnings `task_field_not_writable` and `task_role_cannot_write` keep it so).
// `permissions` grants more than the tasks use (`today`): writes to the feature a task creates (plan never checks them),
// rights on a type that no task of the role touches (a reporter's own `meldung` values after the report, `bezirk` that
// only an admin's `$create` makes) and a few unused ones (`verwaltung` writing `baum.stage`). So deriving the rights
// would change nothing a participant can do through a task, only drop rights that no task can reach. The keys stay
// until the lead decides.
const SURPLUS: Readonly<Record<string, number>> = {
  'baumkataster/1.0.0': 23,
  'baumkataster/1.1.0': 21,
  'baumkataster/2.0.0': 21,
  'maengelmelder/1.0.0': 17,
  'veranstaltung/1.0.0': 14,
};

describe('derived rights against permissions (golden templates)', () => {
  it.each(compiled)('%s: the tasks give no right that permissions refuse', (name, config) => {
    const r = compare(config);
    expect(r.derived, name).toEqual([]);
    expect(r.today.length, `${name}\n${r.today.join('\n')}`).toBe(SURPLUS[name]);
  });

  it('a role reaches a type only through a task: create, then.set on a bound Objekt and a lifecycle step', () => {
    const [, config] = compiled.find(([n]) => n === 'baumkataster/2.0.0') ?? [];
    if (config === undefined) throw new Error('no template');
    const d = deriveRights(config);
    expect([...(d.create.get('massnahme') ?? [])].sort()).toEqual(['kontrolle', 'verwaltung']);
    // `massnahme_erledigen` (bauhof) writes erledigt_am on the measure and `tree.stage` on the bound tree
    expect(d.write.get('massnahme')?.get('erledigt_am')).toEqual(new Set(['bauhof']));
    expect(d.write.get('baum')?.get('stage')).toEqual(new Set(['kontrolle', 'bauhof']));
    // `kontrolle` sets `area.letzte_kontrolle` on the bound area
    expect(d.write.get('flaeche')?.get('letzte_kontrolle')).toEqual(new Set(['kontrolle']));
    expect(d.delete.size).toBe(0);
  });
});
