// WP-306: plan writes `$created_by` on create; rules read `self.$…` system fields; "Nur eigene" as a permission.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { compile } from '../schema/compile';
import { TemplateFileSchema } from '../schema/file';
import { goldenAssets } from '../testing/golden';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'au', version: '1.0.0' },
  roles: { worker: { label: 'Worker' } },
  types: {
    fall: {
      label: 'Fall',
      permissions: {
        see: '$all',
        create: '$all',
        write: '$all',
        visible_when: 'self.$created_by == actor.id',
      },
      properties: { note: { type: 'text' } },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$none', creates: 'fall', form: { note: {} } },
    note: { label: 'Note', on: 'fall', form: { note: {} } },
    complete: { label: 'Complete', on: 'fall', then: [{ lifecycle: 'completed' }] },
    tag: {
      label: 'Tag',
      on: 'fall',
      then: [{ set: { note: "'closed'" }, when: "self.$lifecycle == 'completed'" }],
    },
    mine: {
      label: 'Mine',
      on: 'fall',
      when: 'self.$created_by == actor.id',
      then: [{ set: { note: "'mine'" } }],
    },
  },
};
const anna = actor('participant', 'anna', ['worker']);
const bernd = actor('participant', 'bernd', ['worker']);

let n = 0;
let clock = 0;
const time = (): string => new Date(Date.UTC(2026, 4, 1, 8, 0, ++clock)).toISOString();
function setup() {
  const config = build(file);
  const w = new World(config);
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (
    task: string,
    by = anna,
    feature?: FeatureId,
    input: Record<string, string> = {},
  ): PlanResult => {
    const r: Run = {
      id: rid(++n),
      task: task as Key,
      actor: by,
      configVersion: 1,
      input,
      clientTime: time(),
      ...(feature === undefined ? {} : { featureId: feature }),
    };
    const res = api.planFor([r], oneVersion(config, perms), p);
    if (res.ok) for (const pr of res.runs) w.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  return { w, go, config, perms };
}
const create = (s: ReturnType<typeof setup>, by = anna): FeatureId => {
  const r = s.go('add', by, undefined, { note: 'x' });
  if (!r.ok) throw new Error(r.refusal.message);
  return r.runs[0]?.created[0] as FeatureId;
};

describe('$created_by', () => {
  it('is written once on create, right after $type, with the actor id and the run time', () => {
    const s = setup();
    const r = s.go('add', anna, undefined, { note: 'x' });
    if (!r.ok) throw new Error('refused');
    const obs = r.runs[0]?.observations ?? [];
    expect(obs.slice(0, 2).map((o) => o.property)).toEqual(['$type', '$created_by']);
    expect(obs[1]?.result).toBe('anna');
    expect(obs.filter((o) => o.property === '$created_by')).toHaveLength(1);
  });

  it('a later run never writes it again', () => {
    const s = setup();
    const id = create(s);
    const r = s.go('note', anna, id, { note: 'y' });
    if (!r.ok) throw new Error('refused');
    expect(r.runs.flatMap((x) => x.observations).some((o) => o.property === '$created_by')).toBe(false);
  });

  it('fold derives createdBy, createdAt and changedAt; a later run moves only changedAt', () => {
    const s = setup();
    const id = create(s);
    const first = s.w.feature(id);
    expect(first?.createdBy).toBe('anna');
    expect(first?.createdAt).toBeDefined();
    expect(first?.changedAt).toBe(first?.createdAt);
    s.go('note', anna, id, { note: 'y' });
    const second = s.w.feature(id);
    expect(second?.createdBy).toBe('anna');
    expect(second?.createdAt).toBe(first?.createdAt);
    expect((second?.changedAt as string) > (first?.createdAt as string)).toBe(true);
    expect(second?.properties).not.toHaveProperty('$created_by');
  });
});

describe('self.$… in rules', () => {
  it('a then step with when: self.$lifecycle == completed fires after the lifecycle step', () => {
    const s = setup();
    const id = create(s);
    s.go('tag', anna, id);
    expect(s.w.feature(id)?.properties['note']).toBe('x');
    s.go('complete', anna, id);
    s.go('tag', anna, id);
    expect(s.w.feature(id)?.properties['note']).toBe('closed');
  });

  it('a task `when` on $created_by offers the task only to the creator', () => {
    const s = setup();
    const id = create(s, anna);
    const run = (by: typeof anna): boolean => s.go('mine', by, id).ok;
    expect(run(bernd)).toBe(false);
    expect(run(anna)).toBe(true);
    expect(s.w.feature(id)?.properties['note']).toBe('mine');
  });

  it('"Nur eigene": visible_when self.$created_by == actor.id hides the entries of others', () => {
    const s = setup();
    const id = create(s, anna);
    const type = s.perms.forType('fall' as Key);
    const feature = s.w.feature(id);
    if (type === undefined || feature === undefined) throw new Error('no type');
    const ctx = (by: typeof anna) => ({
      vars: new Map([['actor', { id: by.id, roles: by.roles, kind: by.kind }]]),
      features: {
        property: (_: FeatureId, key: string) =>
          key === '$created_by' ? feature.createdBy : (feature.properties[key] ?? undefined),
        related: () => [],
        history: () => [],
        type: () => 'fall' as Key,
      },
      now: time(),
      relations: s.config.relations,
      geo: ports(s.w).geo,
    });
    expect(type.canSee(s.perms.subjects(anna), feature, ctx(anna)).ok).toBe(true);
    expect(type.canSee(s.perms.subjects(bernd), feature, ctx(bernd)).ok).toBe(false);
  });
});

describe('compile', () => {
  const compileWith = (when: string) =>
    compile(
      TemplateFileSchema.parse({
        ...file,
        tasks: { ...file.tasks, bad: { label: 'Bad', on: 'fall', when } },
      }),
      { assets: goldenAssets },
    );
  it('an unknown self.$foo is a compile problem', () => {
    const r = compileWith('self.$foo == 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.problems)).toContain("no property '$foo'");
  });
  it('$foo without self. is a parse error, reported as a compile problem', () => {
    expect(compileWith('$foo == 1').ok).toBe(false);
  });
  it('visible_when on $created_by compiles to SQL (no visible_when_not_sql warning)', () => {
    const r = compileWith("self.$lifecycle == 'active'");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.filter((w) => w.code === 'visible_when_not_sql')).toEqual([]);
  });
});

void fid;
