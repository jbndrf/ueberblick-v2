// WP-719: in the Mängelmelder a Melder sees her own reports. The scenario is
// fixtures/golden/scenarios/maengelmelder/melder_sees_own_reports.yaml (whose view and
// app_profile steps the runner does not execute); this spec runs the same facts through core.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile } from '../schema/compile';
import { merge } from '../template';
import { OverlayFileSchema, TemplateFileSchema } from '../schema/file';
import { compilePerms } from '../perms';
import type { FeatureState, Key } from '../model';
import { goldenAssets } from '../testing/golden';
import { compileFilter, applyFilter } from './index';
import { actorOf, envOver, featureOf } from './__fixtures__/views-world';

const text = (g: Record<string, unknown>): unknown => parse(Object.values(g)[0] as string);
const template = TemplateFileSchema.parse(
  text(
    import.meta.glob('/fixtures/golden/templates/maengelmelder/1.0.0.yaml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ),
);
const overlay = OverlayFileSchema.parse(
  text(
    import.meta.glob('/fixtures/golden/projects/stadtwerke-meldungen.yaml', {
      query: '?raw',
      import: 'default',
      eager: true,
    }),
  ),
);
const compiled = compile(TemplateFileSchema.parse(merge(template, overlay).file), { assets: goldenAssets });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
const config = compiled.config;
const perms = compilePerms(config);

const report = (id: string, melder: string, kategorie: string): FeatureState =>
  featureOf(id, 'meldung', { melder, kategorie, status: 'offen' });
const all = [
  report('m_mia', 'mia', 'strasse'),
  report('m_mia_ohne', 'mia', 'muell'),
  report('m_max', 'max', 'muell'),
];

const subjectsOf = (id: string, roles: string[]) => {
  const a = actorOf(roles, id);
  return { a, readable: perms.forType('meldung' as Key)?.readable(perms.subjects(a)) };
};

describe('a Melder sees her own reports (WP-719)', () => {
  it("meine_meldungen returns exactly the actor's own reports", () => {
    const view = config.file.views?.meine_meldungen;
    expect(view?.source).toMatchObject({ type: 'meldung' });
    const source = (view?.source as { filter: string }).filter;
    const f = compileFilter(config, { meldung: source });
    if (!f.ok) throw new Error(JSON.stringify(f.problems));
    for (const [who, ids] of [
      ['mia', ['m_mia', 'm_mia_ohne']],
      ['max', ['m_max']],
    ] as const) {
      const a = actorOf(['melder'], who);
      const got = applyFilter(
        { config, perms, actor: a, ctx: envOver(config, a, all).ctx },
        f.filter,
        'meldung',
        all,
      );
      expect(got.map((x) => x.id)).toEqual(ids);
    }
  });
  it('the Melder may read the property melder; the Handwerker may not', () => {
    expect(subjectsOf('mia', ['melder']).readable?.has('melder')).toBe(true);
    expect(subjectsOf('hans', ['handwerker']).readable?.has('melder')).toBe(false);
    expect(subjectsOf('sabine', ['sachbearbeiter']).readable?.has('melder')).toBe(true);
  });
  it('her home view is meine_meldungen', () => {
    const app = config.file.roles?.melder?.app;
    expect(app?.home).toBe('meine_meldungen');
    expect(Object.keys(app?.shortcuts ?? {})).toEqual(['melden']);
  });
});
