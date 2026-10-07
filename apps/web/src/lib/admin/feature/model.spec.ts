// WP-362: the detail page's data. The grouping is the participant sheet's (`buildActivity`); these specs fix what the admin
// page adds: names, refused runs, Daten groups.
import { describe, expect, it } from 'vitest';
import { actorLabel, buildDetail, groupRows } from './model';
import { input, runs } from './fixtures.testing';

describe('Aktivität: a reference value (WP-1076)', () => {
  const id = 'a7d3d241-8c7e-71ca-8727-44ab2c8a8720';
  const gone = '5089e484-874a-74ab-9db1-dfa80a72cf87';
  const withReference = (featureLabels?: Record<string, string>) => {
    const base = input();
    const r = runs[1];
    if (r === undefined) throw new Error('fixture');
    const type = {
      ...base.type,
      properties: { ...base.type.properties, pate: { type: 'reference', to: 'baum', label: { de: 'Pate' } } },
    } as typeof base.type;
    const run = { ...r, observations: [{ property: 'pate', result: [id, gone], time: null }] };
    return buildDetail({
      ...base,
      type,
      runs: [run],
      ...(featureLabels === undefined ? {} : { featureLabels }),
    });
  };
  const text = (d: ReturnType<typeof withReference>) =>
    d.activity.segments.flatMap((s) => s.entries).flatMap((e) => e.fields.map((f) => f.text))[0];

  it('shows the name of a resolved reference and the short id of an unresolved one, never the id', () => {
    expect(text(withReference({ [id]: 'Baum #8720' }))).toBe('Baum #8720, #cf87');
    expect(text(withReference())).toBe('#8720, #cf87');
  });
});

describe('Aktivität', () => {
  it('groups the runs by stage visit, newest first, with the creation in the first visit', () => {
    const { activity } = buildDetail(input());
    expect(activity.segments.map((s) => s.stageLabel)).toEqual(['Kontrolliert', 'Erfasst']);
    const [now, first] = activity.segments;
    expect(now?.entries.map((e) => e.runId)).toEqual(['r3', 'r2']);
    expect(now?.transition?.by).toBe('Anna Beispiel');
    expect(first?.creation?.label.kind).toBe('created');
  });

  it('labels a run by what it changed and shows the values', () => {
    const run = buildDetail(input()).activity.segments[0]?.entries.find((e) => e.runId === 'r2');
    expect(run?.label).toEqual({ kind: 'fields', count: 2 });
    expect(run?.fields.map((f) => [f.label, f.text])).toEqual([
      ['Befund', 'Kronenpflege'],
      ['Höhe (m)', '12,5'],
    ]);
    expect(run?.actorLabel).toBe('Bernd Beispiel');
    expect(run?.task).toBe('Kontrolle');
  });

  it('a run that moved the Objekt shows as the visit heading, not as an entry of its own', () => {
    const { activity } = buildDetail(input());
    expect(activity.segments[0]?.entries.some((e) => e.runId === 'r1')).toBe(false);
    expect(activity.segments[0]?.transition).toBeDefined();
  });

  it('keeps a refused run with its status and its reason', () => {
    const detail = buildDetail(input());
    const refused = detail.activity.segments[0]?.entries.find((e) => e.runId === 'r3');
    expect(refused?.status).toBe('refused');
    expect(detail.refusals.get('r3')).toBe('Befund muss sich ändern');
    expect(detail.refusals.has('r2')).toBe(false);
  });

  it('shows Erstellt from the audit fields without runs, and nothing without those', () => {
    expect(buildDetail(input({ runs: [] })).activity.segments.length).toBe(1); // "Erstellt" from the audit fields
    const none = buildDetail(input({ runs: [], row: { ...input().row, $created_at: undefined } }));
    expect(none.activity.segments).toEqual([]);
  });

  it('names an actor by the roster, then the participant record, then the id', () => {
    const r = runs[1];
    if (r === undefined) throw new Error('fixture');
    const actors = { system: 'System', importBy: (a: string) => `Import (${a})` };
    expect(actorLabel(r, { u2: 'Roster' }, actors)).toBe('Roster');
    expect(actorLabel(r, {}, actors)).toBe('Bernd Beispiel');
    expect(actorLabel({ ...r, actor: { id: 'root', kind: 'admin', name: null } }, {}, actors)).toBe('root');
    const as = (id: string, kind: 'import' | 'system') => ({ ...r, actor: { id, kind, name: null } });
    expect(actorLabel(as('import:a1', 'import'), { a1: 'chef@example.org' }, actors)).toBe(
      'Import (chef@example.org)',
    );
    expect(actorLabel(as('system', 'system'), {}, actors)).toBe('System');
  });

  it('records the lifecycle a run set', () => {
    const lifecycle = {
      ...(runs[1] as (typeof runs)[number]),
      id: 'r9',
      observations: [{ property: '$lifecycle', result: 'archived', time: null }],
    };
    expect(buildDetail(input({ runs: [lifecycle, ...runs] })).lifecycles.get('r9')).toBe('archived');
  });
});

describe('Daten', () => {
  it('lists the properties in the Objektart order, grouped by tab, general first, without stage and location', () => {
    const { sheet } = buildDetail(input());
    const groups = groupRows(sheet.rows, input().type, 'de');
    expect(groups.map((g) => g.name)).toEqual([null, 'Pflege']);
    expect(groups[0]?.rows.map((r) => r.key)).toEqual(['titel', 'befund', 'hoehe_m', 'kontrolle_faellig']);
    expect(groups[1]?.rows.map((r) => r.key)).toEqual(['zustaendig']);
  });

  it('formats a value as the participant sheet does: names, booleans, numbers', () => {
    const rows = buildDetail(input()).sheet.rows;
    const text = (key: string): string | undefined => rows.find((r) => r.key === key)?.text;
    expect(text('zustaendig')).toBe('Bernd Beispiel');
    expect(text('kontrolle_faellig')).toBe('Ja');
    expect(text('hoehe_m')).toBe('12,5');
    expect(text('stage')).toBe('Kontrolliert');
  });

  it('shows the display name as the title', () => {
    expect(buildDetail(input()).sheet.title).toBe('Eiche am Markt');
  });
});

describe('Rollen (WP-459)', () => {
  it('shows a role property by its label, an unknown key as it is', () => {
    const base = input();
    const type = {
      ...base.type,
      properties: { ...base.type.properties, rolle: { type: 'role', label: { de: 'Rolle' } } },
    } as typeof base.type;
    const roleLabels = { kontrolle: { de: 'Kontrolle' } };
    const text = (key: string): string | undefined =>
      buildDetail({ ...base, type, row: { ...base.row, rolle: key }, roleLabels }).sheet.rows.find(
        (r) => r.key === 'rolle',
      )?.text;
    expect(text('kontrolle')).toBe('Kontrolle');
    expect(text('weg')).toBe('weg');
  });
});
