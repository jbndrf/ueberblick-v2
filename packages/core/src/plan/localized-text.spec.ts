// WP-676: the planner takes a localized_text property as a localized value and refuses a bare string.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import { inlineFile } from './__fixtures__/inline';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);

type File = {
  types: Record<string, { properties: Record<string, unknown> }>;
  tasks: Record<string, unknown>;
};

function setup() {
  const file = inlineFile(3) as File;
  const guarded = file.types['guarded'];
  if (!guarded) throw new Error('fixture lost its guarded type');
  guarded.properties['beschreibung'] = { type: 'localized_text' };
  file.tasks['edit_beschreibung'] = { label: 'Edit', on: 'guarded', form: { beschreibung: {} } };
  const config = build(file);
  const w = new World(config);
  w.add(fid(1), 'guarded', { note: 'x' });
  return { config, perms: compilePerms(config), p: ports(w) };
}
const run = (input: Record<string, Json>): Run => ({
  id: rid(1),
  task: 'edit_beschreibung' as Key,
  actor: maker,
  configVersion: 1,
  input,
  featureId: fid(1),
});

describe('localized_text through the planner', () => {
  it('accepts a localized value and writes it as one observation', () => {
    const { config, perms, p } = setup();
    const r = planApi.planFor(
      [run({ beschreibung: { de: 'Alte Eiche', en: 'Old oak' } })],
      oneVersion(config, perms),
      p,
    );
    expect(r.ok && r.runs[0]?.observations.map((o) => o.property)).toEqual(['beschreibung']);
  });
  it('refuses a bare string (the bug of the form and quick edit)', () => {
    const { config, perms, p } = setup();
    const r = planApi.planFor([run({ beschreibung: 'Alte Eiche' })], oneVersion(config, perms), p);
    expect(!r.ok && r.refusal.code).toBe('invalid_input');
    expect(!r.ok && r.refusal.message).toContain('beschreibung');
  });
});
