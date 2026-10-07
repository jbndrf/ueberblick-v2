// WP-756 (H8): who a participant may choose is enforced in plan, with the same `participantChoice` the UI uses (B-022).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import type { PlanResult } from './contract';
import { createPlan, oneVersion } from './index';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const POINT = { type: 'Point', coordinates: [1, 1] };

const file = {
  schema: 'ueberblick/1',
  template: { key: 'choice', version: '1.0.0' },
  roles: { worker: { label: 'W' }, lead: { label: 'L' }, buddy: { label: 'B' } },
  types: {
    job: {
      label: 'Job',
      geometry: 'geom',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        geom: { type: 'geometry', geometry_type: 'point' },
        owner: { type: 'participant', select: { all: ['lead'], self: ['buddy'] } },
        plain: { type: 'participant' },
      },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$map', creates: 'job', form: { geom: {}, owner: {}, plain: {} } },
    assign: { label: 'Assign', on: 'job', form: { owner: {}, plain: {} } },
  },
};

const config = build(file);
const worker = actor('participant', 'bernd', ['worker']);
const lead = actor('participant', 'vera', ['lead']);
const buddy = actor('participant', 'carl', ['buddy']);
const MEMBERS = new Set(['bernd', 'vera', 'carl', 'anna']);

let n = 0;
function plan(
  who: ReturnType<typeof actor>,
  task: string,
  input: Record<string, Json>,
  members = true,
): PlanResult {
  const w = new World(config);
  const id: FeatureId = fid(1);
  w.add(id, 'job', { geom: POINT });
  const run: Run = {
    id: rid(++n),
    task: task as Key,
    actor: who,
    configVersion: 1,
    input,
    ...(task === 'assign' ? { featureId: id } : {}),
  };
  const p = ports(w);
  return planApi.planFor(
    [run],
    oneVersion(config, compilePerms(config)),
    members ? { ...p, isParticipant: (x: string) => MEMBERS.has(x) } : p,
  );
}
const code = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

describe('participant choice in plan', () => {
  it('a role without `select` may choose only itself (H8: bernd cannot assign anna)', () => {
    expect(code(plan(worker, 'assign', { plain: 'anna' }))).toBe('not_permitted');
    expect(code(plan(worker, 'add', { geom: POINT, plain: 'anna' }))).toBe('not_permitted');
    expect(code(plan(worker, 'assign', { plain: 'bernd' }))).toBe('ok');
  });
  it('a role in select.self may choose only itself', () => {
    expect(code(plan(buddy, 'assign', { owner: 'anna' }))).toBe('not_permitted');
    expect(code(plan(buddy, 'assign', { owner: 'carl' }))).toBe('ok');
  });
  it('a role in neither list may choose nobody (v3 default deny)', () => {
    expect(code(plan(worker, 'assign', { owner: 'bernd' }))).toBe('not_permitted');
  });
  it('a role in select.all may choose any member; a non-member is refused', () => {
    expect(code(plan(lead, 'assign', { owner: 'anna' }))).toBe('ok');
    expect(code(plan(lead, 'assign', { owner: 'nobody' }))).toBe('not_permitted');
  });
  it('an empty value (clearing) passes for everyone', () => {
    expect(code(plan(worker, 'assign', { plain: '' }))).toBe('ok');
  });
  it('the web choices and plan share one function (R1)', () => {
    const root = new URL('../../../../', import.meta.url);
    const ui = readFileSync(new URL('apps/web/src/lib/participant/form/choices.ts', root), 'utf8');
    const core = readFileSync(new URL('packages/core/src/plan/participant-choice.ts', root), 'utf8');
    expect(ui).toMatch(/import \{ participantChoice \} from '@ueberblick\/core'/);
    expect(core).toMatch(/participantChoice/);
    expect(core).not.toMatch(/\.select\b/);
  });
});

describe('WP-799: participant-choice reads no schema module at runtime', () => {
  it('only type-imports from schema (zod stays out of the participant shell)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./participant-choice.ts', import.meta.url), 'utf8');
    const imports = src.split('\n').filter((l) => /^import /.test(l) && /schema|zod/.test(l));
    for (const l of imports) expect(l).toMatch(/^import type /);
  });
});
