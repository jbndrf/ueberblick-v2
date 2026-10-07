/** WP-172: personal v3 fields become `personal` properties, and an erasure task is emitted (A-021, A-023). */
import {
  compilePerms,
  createGeo,
  createPlan,
  oneVersion,
  formApi,
  PLAN_MAX_RULE_DEPTH,
  type Actor,
  type FeatureId,
  type Key,
  type PlanPorts,
  type RunId,
} from '@ueberblick/core';
import { MemoryStore } from '@ueberblick/core/memory';
import { describe, expect, it } from 'vitest';
import { compileConverted } from '../diffcheck/diffcheck';
import { convertConfig } from './convert';
import { personalReason } from './personal';
import { loadFixture } from './testing';

const baum = convertConfig(loadFixture('baumkontrolle'));
const meldung = convertConfig(loadFixture('meldungen'));
const minimal = convertConfig(loadFixture('minimal'));

describe('the rule list', () => {
  const field = (type: string, key = 'x', label = 'X', opts: Record<string, unknown> = {}) =>
    personalReason({ type, key, label, options: opts });
  const sel = { source_type: 'participants' };
  it('marks e-mail fields', () => {
    expect(field('email')).toBeDefined();
  });
  it('marks a participant selector only when its name is reporter-like', () => {
    expect(field('custom_table_selector', 'zustaendig', 'Zuständig', sel)).toBeUndefined();
    expect(field('custom_table_selector', 'melder', 'Melder', sel)).toBeDefined();
    expect(field('custom_table_selector', 'melder', 'Melder', { source_type: 'roles' })).toBeUndefined();
  });
  it('marks text fields with a whole word that names a person or a way to reach one', () => {
    for (const k of [
      'melder',
      'telefon',
      'Handy',
      'reporter_name',
      'adresse',
      'contact',
      'telefonNummer',
      'e-mail',
      'mobil-nr',
    ])
      expect(field('short_text', k), k).toBeDefined();
    expect(field('long_text', 'x', 'Anschrift des Melders')).toBeDefined();
  });
  it('matches whole words only', () => {
    for (const k of [
      'mobilitaet',
      'mobilfunk',
      'telemetrie',
      'hotel',
      'detail',
      'tellerrand',
      'kontaktiert',
      'mailand',
      'handyman',
      'Mobilität',
    ])
      expect(field('short_text', k, k), k).toBeUndefined();
  });
  it('leaves other fields alone', () => {
    for (const t of ['number', 'date', 'dropdown', 'file']) expect(field(t, 'telefon'), t).toBeUndefined();
    expect(field('short_text', 'name', 'Name')).toBeUndefined();
    expect(field('long_text', 'befund', 'Befund')).toBeUndefined();
  });
});

describe('the converted template', () => {
  it('marks the e-mail field as personal data of the actor, and reports it', () => {
    expect(baum.template.types?.['baum']?.properties['kontakt']?.personal).toEqual({ subject: 'actor' });
    expect(baum.personal.map((p) => p.target)).toContain('types.baum.properties.kontakt');
    expect(baum.personal.every((p) => p.reason !== '')).toBe(true);
    expect(baum.personal.map((p) => p.target)).toEqual(['types.baum.properties.kontakt']);
    expect(baum.template.types?.['baum']?.properties['zustaendig']?.personal).toBeUndefined();
    expect(meldung.personal.map((p) => p.target)).toEqual([]);
  });

  it('emits an erasure task with a redact step, open to admins only, and its type', () => {
    const t = baum.template.tasks?.['erase_subject'];
    expect(t).toMatchObject({
      on: '$none',
      who: ['admin'],
      form: { subject: { required: true } },
      then: [{ redact: { subject: 'actor', of: 'form.subject' } }],
    });
    expect(t?.creates).toBe('erasure');
    expect(baum.template.types?.['erasure']?.properties['subject']).toMatchObject({ type: 'participant' });
    expect(baum.check.ok).toBe(true);
  });

  it('emits nothing when no field is personal', () => {
    expect(minimal.personal).toEqual([]);
    expect(minimal.template.tasks?.['erase_subject']).toBeUndefined();
    expect(minimal.template.types?.['erasure']).toBeUndefined();
  });

  it('keeps keys free: a workflow named erasure does not collide', () => {
    const v3 = structuredClone(loadFixture('baumkontrolle')) as { workflows: { key: string }[] };
    (v3.workflows[0] as { key: string }).key = 'erasure';
    const r = convertConfig(v3);
    expect(r.check.ok).toBe(true);
    expect(r.template.tasks?.['erase_subject']?.creates).not.toBe('erasure');
  });

  it('is deterministic, and meldungen compiles', () => {
    expect(meldung.check.ok).toBe(true);
    expect(convertConfig(loadFixture('baumkontrolle'))).toEqual(baum);
  });
});

/** A converted baumkontrolle project with an in-memory store, to plan runs against. */
function setup() {
  const config = compileConverted(baum);
  const perms = compilePerms(config);
  const geo = createGeo();
  const now = '2026-09-30T10:00:00.000Z';
  const world = new MemoryStore(config, { now: () => now }, geo, 1);
  let n = 0;
  const uuid = (p: number): string =>
    `${p.toString(16).padStart(8, '0')}-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const ports: PlanPorts = {
    clock: { now: () => now },
    facts: world,
    geo,
    limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
  };
  /** A feature of `baum` written by `who` (attributed to them), as an earlier run would have. */
  const write = (who: string, props: Record<string, string>): FeatureId => {
    const f = uuid(9) as FeatureId;
    world.append(
      uuid(3) as RunId,
      [
        { featureId: f, property: '$type', result: 'baum' },
        ...Object.entries(props).map(([property, result]) => ({ featureId: f, property, result })),
      ],
      who,
    );
    return f;
  };
  const erase = (by: Actor, subject: string) =>
    createPlan(formApi).planFor(
      [
        {
          id: uuid(4) as RunId,
          task: 'erase_subject' as Key,
          actor: by,
          configVersion: 1,
          input: { subject },
        },
      ],
      oneVersion(config, perms),
      ports,
    );
  /** Plans and commits an erasure that must be accepted. */
  const eraseOk = (subject: string): readonly { featureId: string; property: string }[] => {
    const res = erase({ id: 'root', kind: 'admin', roles: [] }, subject);
    if (!res.ok) throw new Error(`${res.refusal.code}: ${res.refusal.message}`);
    const planned = res.runs[0];
    if (!planned) throw new Error('no run');
    world.append(planned.run.id, planned.observations);
    return planned.purge;
  };
  return { config, world, write, erase, eraseOk };
}

describe('an erasure run on the migrated project', () => {
  it('blanks the e-mail the person wrote, and only theirs', () => {
    const s = setup();
    const f1 = s.write('anna', { kontakt: 'anna@example.org' });
    const f2 = s.write('bernd', { kontakt: 'bernd@example.org' });
    expect(s.eraseOk('anna')).toEqual([{ featureId: f1, property: 'kontakt' }]);
    expect(s.world.feature(f1)?.properties['kontakt']).toBeNull();
    expect(s.world.feature(f2)?.properties['kontakt']).toBe('bernd@example.org');
  });

  it('an assignment is not personal data of the assigner: erasing X or Z blanks only what they wrote', () => {
    const s = setup();
    // X (a handler) assigns Z and leaves a contact; Z writes a contact of their own
    const f1 = s.write('x', { zustaendig: 'z', kontakt: 'x@example.org' });
    const f2 = s.write('z', { kontakt: 'z@example.org' });
    expect(s.eraseOk('z')).toEqual([{ featureId: f2, property: 'kontakt' }]);
    expect(s.world.feature(f2)?.properties['kontakt']).toBeNull();
    expect(s.world.feature(f1)?.properties['kontakt']).toBe('x@example.org');
    expect(s.world.feature(f1)?.properties['zustaendig']).toBe('z');
    expect(s.eraseOk('x')).toEqual([{ featureId: f1, property: 'kontakt' }]);
    expect(s.world.feature(f1)?.properties['kontakt']).toBeNull();
    expect(s.world.feature(f1)?.properties['zustaendig']).toBe('z');
  });
});

describe('who may erase (the erasure type is write-open, the task is not)', () => {
  const refused: [string, Actor][] = [
    ['a participant without roles', { id: 'p', kind: 'participant', roles: [] }],
    ['a participant with a converted role', { id: 'p', kind: 'participant', roles: ['verwaltung' as Key] }],
    ['the import actor', { id: 'imp', kind: 'import', roles: [] }],
  ];
  it.each(refused)('refuses %s: nothing is planned, nothing is purged', (_name, actor) => {
    const s = setup();
    const f = s.write('anna', { kontakt: 'anna@example.org' });
    const res = s.erase(actor, 'anna');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(s.world.feature(f)?.properties['kontakt']).toBe('anna@example.org');
  });

  it('no other task creates the erasure type or acts on it', () => {
    const tasks = Object.entries(baum.template.tasks ?? {}).filter(([k]) => k !== 'erase_subject');
    expect(tasks.length).toBeGreaterThan(0);
    for (const [k, t] of tasks) {
      expect(t.creates, k).not.toBe('erasure');
      expect(t.on, k).not.toBe('erasure');
    }
  });
});
