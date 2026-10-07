/** What specific v3 configurations become in v4: the conversion rules of docs/user/admin/migration-from-v3.md. */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convertConfig } from './convert';
import type { ExprEnv } from './exprs';
import { formula } from './formula';
import { KeySpace, slug } from './keys';
import { K } from './read-parts';
import { loadFixture } from './testing';
import { KeySchema, listAutos } from '@ueberblick/core';

const baum = convertConfig(loadFixture('baumkontrolle'));
const meldung = convertConfig(loadFixture('meldungen'));
const minimal = convertConfig(loadFixture('minimal'));
const item = (r: typeof baum, id: string) => r.report.items.find((i) => i.id === id);

describe('feature types', () => {
  it('turns a workflow into a feature type with a geometry property and a stage select', () => {
    const t = baum.template.types?.['baum'];
    expect(t?.geometry).toBe('geom');
    expect(t?.properties['geom']).toMatchObject({ type: 'geometry', geometry_type: 'point' });
    const stage = t?.properties['stage'];
    expect(stage).toMatchObject({ type: 'select', default: 'erfasst' });
    expect(Object.keys(stage?.options ?? {})).toEqual(['erfasst', 'kontrolliert', 'massnahme', 'erledigt']);
  });

  it('maps the v3 geometry kinds to GeoJSON kinds', () => {
    expect(baum.template.types?.['flaeche']?.properties['geom']?.geometry_type).toBe('polygon');
    expect(baum.template.types?.['leitung']?.properties['geom']?.geometry_type).toBe('linestring');
  });

  it('turns a custom table into a lookup feature type that fields reference', () => {
    const table = baum.template.types?.['baumart'];
    expect(table?.geometry).toBeUndefined();
    expect(Object.keys(table?.properties ?? {})).toEqual(['name', 'hoehe_max', 'eingefuehrt', 'geschuetzt']);
    expect(baum.template.types?.['baum']?.properties['art']).toMatchObject({
      type: 'reference',
      to: 'baumart',
    });
  });

  it('turns option labels into option keys and records the map for the data conversion', () => {
    const p = baum.template.types?.['baum']?.properties['vitalitaet'];
    expect(p?.options).toEqual({ v0: '0', v1: '1', v2: '2', v3: '3', v4: '4' });
    expect(baum.mapping.types['baum']?.properties['vitalitaet']?.options?.['3']).toBe('v3');
    expect(baum.mapping.types['baum']?.stage?.options['massnahme']).toBe('massnahme');
    expect(baum.mapping.roles['kontrolle']).toBe('kontrolle');
    expect(baum.mapping.tasks['baum/kontrolle']).toBe('kontrolle');
  });

  it('turns the relation catalog into a reference and an inverse relation', () => {
    expect(baum.template.types?.['baum']?.properties['flaeche_baeume']).toMatchObject({
      type: 'reference',
      to: 'flaeche',
    });
    expect(baum.template.types?.['flaeche']?.relations?.['flaeche_baeume_baum']).toEqual({
      to: 'baum',
      inverse_of: 'baum.flaeche_baeume',
      cardinality: 'many',
    });
  });

  it('lets the audience of the task that computes a field write it, and nobody else', () => {
    expect(baum.template.types?.['baum']?.permissions?.write).toMatchObject({ kronenflaeche: ['kontrolle'] });
  });

  it('keeps a computed field that no participant task computes writable by system runs only', () => {
    const v3 = structuredClone(loadFixture('baumkontrolle')) as {
      workflows: { key: string; document: { tasks: { key: string; effects: unknown[] }[] } }[];
    };
    const task = v3.workflows
      .find((w) => w.key === 'baum')
      ?.document.tasks.find((t) => t.key === 'kontrolle');
    if (task) task.effects = task.effects.filter((e) => (e as { effect: string }).effect !== 'compute');
    const r = convertConfig(v3);
    expect(r.check.ok).toBe(true);
    expect(r.template.types?.['baum']?.permissions?.write).toMatchObject({ kronenflaeche: [] });
  });

  it('writes contains as a case-insensitive text test, as v3 matched', () => {
    const when = baum.template.tasks?.['pruefen']?.when ?? '';
    expect(when).toContain("self.befund.lower().contains('Pilz'.lower())");
  });

  it('models a many-valued instance reference as a relation of cardinality many with a reference on the child', () => {
    expect(baum.template.types?.['baum']?.properties['kinder']).toBeUndefined();
    expect(baum.template.types?.['baum']?.relations?.['kinder']).toEqual({
      to: 'massnahme',
      inverse_of: 'massnahme.baum',
      cardinality: 'many',
    });
    expect(baum.template.types?.['massnahme']?.properties['baum']).toMatchObject({
      type: 'reference',
      to: 'baum',
    });
    expect(baum.mapping.types['baum']?.properties['kinder']).toMatchObject({
      property: 'kinder',
      inverse: { type: 'massnahme', property: 'baum' },
    });
    expect(item(baum, `workflows.baum.${K.props}.kinder.field_options`)?.status).toBe('mapped');
    expect(baum.check.ok).toBe(true);
    expect(baum.check.problems).toEqual([]);
  });

  it('lists the compile warnings in the report, so an admin sees dead options', () => {
    expect(baum.report.warnings).toEqual(baum.check.warnings);
    expect(baum.report.warnings.some((w) => w.code === 'dead_option')).toBe(true);
  });

  it('never widens v3 write roles: a field the task roles may not write leaves the form and is reported', () => {
    expect(baum.report.warnings.filter((w) => w.code === 'task_field_not_writable')).toEqual([]);
    const write = baum.template.types?.['baum']?.permissions?.write;
    expect(write).toMatchObject({ interne_notiz: ['verwaltung'] });
    expect(baum.template.tasks?.['kontrolle']?.form).not.toHaveProperty('interne_notiz');
    const it = baum.report.items.find((i) => i.reason.includes('shown read-only in v3'));
    expect(it?.status).toBe('approximated');
  });

  it('asks for an index on a filterable tag', () => {
    expect(baum.template.types?.['baum']?.properties['vitalitaet']?.index).toBe(true);
    expect(item(baum, 'workflows.baum.field_tags.0.0')?.status).toBe('approximated');
  });
});

describe('permissions', () => {
  it('lists the roles of the entry task as the create audience', () => {
    expect(baum.template.types?.['baum']?.permissions?.create).toEqual(['kontrolle', 'verwaltung']);
  });

  it('turns per-field view roles into per-property visibility', () => {
    expect(baum.template.types?.['baum']?.permissions?.see).toEqual({ interne_notiz: ['verwaltung'] });
  });

  it('turns private cases into a row filter on a created-by property set at creation', () => {
    const t = meldung.template.types?.['meldung'];
    expect(t?.properties['created_by']?.type).toBe('participant');
    expect(t?.permissions?.visible_when).toContain('self.created_by == actor.id');
    expect(meldung.template.tasks?.['melden']?.then).toContainEqual({ set: { created_by: 'actor.id' } });
  });

  it('keeps row roles in the row filter when properties have their own visibility', () => {
    const t = meldung.template.types?.['meldung'];
    expect(t?.permissions?.see).toEqual({ prio: ['amt'] });
    expect(t?.permissions?.visible_when).toContain("'buerger' in actor.roles || 'amt' in actor.roles");
  });

  it('hides an inactive workflow from every role', () => {
    expect(meldung.template.types?.['altfall']?.permissions?.see).toEqual([]);
    expect(item(meldung, 'workflows.altfall.is_active')?.status).toBe('approximated');
  });
});

describe('tasks', () => {
  it('offers an entry task from the map and creates the type', () => {
    expect(baum.template.tasks?.['erfassen']).toMatchObject({
      on: '$map',
      creates: 'baum',
      who: ['kontrolle', 'verwaltung'],
    });
    expect(baum.template.tasks?.['erfassen']?.form?.['geom']).toEqual({ tool: 'draw', required: true });
  });

  it('turns clauses into one expression and fails closed when a clause cannot be translated', () => {
    // the `role` clause is the task's `who`, no longer part of the condition
    expect(baum.template.tasks?.['kontrolle']?.who).toEqual(['kontrolle']);
    const w = baum.template.tasks?.['kontrolle']?.when ?? '';
    expect(w).not.toContain('actor.roles');
    expect(w).toContain("self.stage in ['erfasst', 'kontrolliert']");
    const bad = loadFixture('minimal') as Record<string, unknown>;
    const wf = (bad['workflows'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    (wf['document'] as Record<string, unknown>)['tasks'] = [
      {
        key: 'x',
        name: 'X',
        activation: { mode: 'available' },
        conditions: [{ kind: 'field', field_def_id: '@field/gibtsnicht', op: 'equals', value: '1' }], // glossary-lint-ignore
        tools: [],
        effects: [],
      },
    ];
    const r = convertConfig(bad);
    expect(r.template.tasks?.['x']?.when).toBe('false');
    expect(item(r, 'workflows.punkt.tasks.x.conditions.0')?.status).toBe('approximated');
    expect(r.check.ok).toBe(true);
  });

  it('turns a force-dirty placement into a constraint and a constant prefill into a calculation', () => {
    expect(baum.template.tasks?.['kontrolle']?.form?.['vitalitaet']).toMatchObject({
      constraint: 'value != self.vitalitaet',
    });
    expect(baum.template.tasks?.['erfassen']?.form?.['vitalitaet']).toMatchObject({ calculate: "'v2'" });
  });

  it('turns a show-if condition into relevant', () => {
    expect(baum.template.tasks?.['kontrolle']?.form?.['befund']?.relevant).toBe("form.vitalitaet >= 'v3'");
  });

  it('turns a transition into a set of the stage and a status effect into the lifecycle property', () => {
    expect(baum.template.tasks?.['kontrolle']?.then).toContainEqual({ set: { stage: "'kontrolliert'" } });
    expect(baum.template.types?.['baum']?.properties['lifecycle']?.options).toMatchObject({
      active: 'Aktiv',
      archived: 'Archiviert',
    });
  });

  it('turns a spawning effect into a separate task that creates the target', () => {
    const spawn = baum.template.tasks?.['massnahme_anlegen_spawn_1'];
    expect(spawn).toMatchObject({ on: 'baum', creates: 'massnahme' });
    expect(spawn?.then).toContainEqual({ set: { geom: 'self.geom' } });
    expect(baum.template.tasks?.['massnahme_anlegen_spawn_2']?.form?.['geom']).toEqual({
      tool: 'draw',
      required: true,
    });
  });

  it('gives every feature type an import task for the actor kind import', () => {
    expect(baum.template.tasks?.['baum_import']).toMatchObject({
      on: '$none',
      who: ['import'],
      creates: 'baum',
    });
    expect(minimal.template.tasks?.['punkt_import']).toBeDefined();
  });
});

describe('roles in tasks (A-009, C-004)', () => {
  it('never emits actor.role; a task names its roles in `who`', () => {
    for (const r of [baum, meldung, minimal]) {
      const text = JSON.stringify([r.template, r.overlay]);
      expect(text).not.toMatch(/actor\.role[^s]/);
    }
    expect(JSON.stringify(baum.template.tasks?.['kontrolle'])).toContain('"who":["kontrolle"]');
  });
});

/** The automatic action `name` of a template, whichever task carries it. */
const autoOf = (template: Parameters<typeof listAutos>[0], name: string) =>
  listAutos(template).find((a) => a.name === name)?.entry;

describe('automatic actions', () => {
  it('turns a triggered task into a system task with an automatic action', () => {
    // no `who`: no person may run it; the system runs it through its `auto` entry
    expect(baum.template.tasks?.['abschliessen']).toMatchObject({ on: 'baum' });
    expect(baum.template.tasks?.['abschliessen']?.who).toBeUndefined();
    expect(baum.template.tasks?.['abschliessen']?.auto?.['abschliessen']).toMatchObject({
      change: 'baum.besichtigt',
    });
  });

  it('turns steps of a run-all rule set into one automatic action each', () => {
    expect(listAutos(baum.template).map((a) => a.name)).toEqual(
      expect.arrayContaining(['nach_kontrolle_1', 'nach_kontrolle_2']),
    );
  });

  it('makes each first-match step exclude the steps before it', () => {
    expect(autoOf(baum.template, 'vitalitaet_prio_2')?.when).toContain("!(self.vitalitaet >= 'v4')");
  });

  it('turns a schedule into the schedule trigger and a task run into a task trigger', () => {
    expect(autoOf(baum.template, 'nachts')).toMatchObject({
      schedule: '0 2 * * *',
      idle: expect.stringMatching(/^days\(\d+\)$/),
    });
    expect(autoOf(baum.template, 'nach_task')?.after).toBe('kontrolle');
  });

  it('drops an elapsed trigger with the reason', () => {
    expect(item(baum, 'workflows.baum.automations.sla.trigger')?.status).toBe('dropped'); // glossary-lint-ignore
    expect(item(baum, 'workflows.baum.automations.sla.trigger')?.reason).toMatch(/date property/); // glossary-lint-ignore
    expect(autoOf(baum.template, 'sla')).toBeUndefined();
  });
});

describe('views, roles, overlay', () => {
  it('builds a map view with one layer per geometric feature type and the v3 colour', () => {
    const karte = baum.template.views?.['karte'];
    expect(Object.keys(karte?.layers ?? {})).toEqual(['flaeche', 'baum', 'leitung']);
    expect(JSON.stringify(karte?.layers?.['baum'])).toContain('#27ae60');
  });

  it('turns data tabs into views that carry their properties', () => {
    expect(baum.template.views?.['baum_messwerte']?.properties).toEqual(['hoehe_m', 'kronenflaeche']);
  });

  it('gives each role a home, its views and the tools that forms use', () => {
    const app = baum.template.roles?.['kontrolle']?.app;
    expect(app?.home).toBe('karte');
    expect(Object.keys(app?.views ?? {})).toContain('baum_liste');
    expect(app?.tools).toEqual({ draw: {} });
    expect(Object.keys(baum.template.roles?.['bauhof']?.app?.views ?? {})).toContain('massnahme_liste');
    expect(Object.keys(baum.template.roles?.['kontrolle']?.app?.views ?? {})).not.toContain(
      'massnahme_liste',
    );
  });

  it("puts the project's own map position into the overlay, and nothing when it is the default", () => {
    expect(meldung.overlay.override).toEqual({ 'views.karte.camera': { center: [11.58, 48.14], zoom: 11 } });
    expect(baum.overlay.override).toEqual({ 'views.karte.camera': { center: [7.63, 51.96], zoom: 13 } });
    expect(minimal.overlay.override).toBeUndefined();
  });

  it('takes the template label from the display name', () => {
    expect(baum.template.template.label).toBe('Baumkontrolle Musterstadt');
    expect(meldung.template.template.key).toBe('maengelmelder');
  });
});

describe('keys', () => {
  it('turns any text into a valid unique key (property test)', () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { minLength: 1, maxLength: 12 }), (inputs) => {
        const space = new KeySpace();
        const keys = inputs.map((i) => space.take(i));
        for (const k of keys) expect(KeySchema.safeParse(k).success).toBe(true);
        expect(new Set(keys).size).toBe(keys.length);
        for (const i of inputs) expect(KeySchema.safeParse(slug(i)).success).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('transliterates German umlauts and avoids reserved words', () => {
    expect(slug('Höhe (m)')).toBe('hoehe_m');
    expect(slug('Größe')).toBe('groesse');
    expect(slug('3. Ordnung', 'v')).toBe('v3_ordnung');
    expect(new KeySpace().take('self')).toBe('self_1');
    const s = new KeySpace(['stage']);
    expect(s.take('stage')).toBe('stage_2');
  });
});

describe('formulas', () => {
  const env = (props: string[]): ExprEnv => ({
    type: {
      v3Key: 't',
      key: 't',
      fromTable: false,
      keys: new KeySpace(),
      props: new Map(
        props.map((p) => [
          p,
          {
            v3Key: p,
            key: p,
            type: 'number',
            options: new Map(),
            writeMode: 'observation',
            constraints: [],
            view: [],
            write: [],
            def: { type: 'number' },
          },
        ]),
      ),
      stageOptions: new Map(),
      stageKey: 'stage',
      creatorKey: 'created_by',
      lifecycleKey: 'lifecycle',
      needsCreator: false,
      statuses: new Set(),
      entryTasks: [],
      createRoles: undefined,
      refTo: new Map(),
      computedBy: new Map(),
    },
    base: 'self',
    role: (r) => r,
    types: () => undefined,
  });

  it('translates arithmetic, comparisons and if', () => {
    expect(formula('{a} * 2 + 1', env(['a']))).toEqual({ expr: 'self.a * 2 + 1', bool: false });
    expect(formula('{a} > 1 and not {b} = 2', env(['a', 'b']))).toEqual({
      expr: 'self.a > 1 && !(self.b == 2)',
      bool: true,
    });
    expect(formula('if({a} > 10, {a} * 4, {a})', env(['a']))?.expr).toBe(
      '(self.a > 10 ? self.a * 4 : self.a)',
    );
  });

  it('refuses functions and unknown fields', () => {
    expect(formula('round({a}, 2)', env(['a']))).toBeUndefined();
    expect(formula('{zzz} + 1', env(['a']))).toBeUndefined();
    expect(formula('{a} +', env(['a']))).toBeUndefined();
  });
});
