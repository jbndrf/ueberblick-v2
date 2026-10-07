// Runs the golden upgrade fixtures (fixtures/golden, WP-011) through merge / upgrade / breakingChanges.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { OverlayFile, TemplateFile } from '../schema';
import { compile, NO_ASSETS } from '../schema/compile';
import { breakingChanges } from './breaking';
import { getAt } from './paths';
import { merge } from './merge';
import { upgrade } from './upgrade';

const golden = (rel: string): unknown => {
  const url = new URL(`../../../../fixtures/golden/${rel}`, import.meta.url);
  return parse(readFileSync(fileURLToPath(url), 'utf8')) as unknown;
};
const tpl = (v: string) => golden(`templates/baumkataster/${v}.yaml`) as TemplateFile;
const project = (name: string) => golden(`projects/${name}.yaml`) as OverlayFile;

const v100 = tpl('1.0.0');
const v110 = tpl('1.1.0');
const v200 = tpl('2.0.0');
const musterstadt = project('musterstadt-baeume');

describe('golden: upgrade_v1_to_v2', () => {
  it('1.0.0 -> 1.1.0 applies the added property automatically', () => {
    const r = upgrade(v100, musterstadt, v110);
    expect(r.conflicts).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.autoApplied).toContain('types.baum.properties.standort_hinweis');
    expect(breakingChanges(v100, v110)).toEqual([]);
  });

  it('1.1.0 -> 2.0.0 gives one conflict, the auto changes and the kept entries of the scenario', () => {
    const r = upgrade(v110, musterstadt, v200);
    expect(r.conflicts).toEqual([
      {
        path: 'types.baum.properties.vitalitaet.label',
        base: { de: 'Vitalität', en: 'Vitality' },
        theirs: { de: 'Vitalität (Stufe)', en: 'Vitality (level)' },
        ours: { de: 'Vitalität (Roloff)', en: 'Vitality (Roloff)' },
      },
    ]);
    expect(r.autoApplied).toEqual(
      expect.arrayContaining([
        'types.baum.properties.befund.label',
        'types.baum.properties.stage.options',
        'tasks.kontrolle.then',
      ]),
    );
    expect(r.autoApplied).not.toContain('types.baum.properties.vitalitaet.label');
    expect(r.unresolved).toEqual([]);
    expect(r.overlay.extends).toBe('baumkataster@2');
    expect(Object.keys(r.overlay.override ?? {})).toEqual([
      'tasks.kontrolle.label',
      'types.baum.properties.vitalitaet.label',
    ]);
    expect(Object.keys(r.overlay.add ?? {})).toEqual(['types.baum.properties.patenschaft', 'views.paten']);
    expect(r.overlay.inputs).toEqual({ kontrollintervall_monate: 18 });
  });

  it('the merged effective config matches the scenario after the overlay value is kept', () => {
    const r = upgrade(v110, musterstadt, v200);
    const eff = merge(v200, r.overlay);
    expect(eff.issues).toEqual([]);
    expect(getAt(eff.file, 'types.baum.properties.vitalitaet.label')).toEqual({
      de: 'Vitalität (Roloff)',
      en: 'Vitality (Roloff)',
    });
    expect(getAt(eff.file, 'types.baum.properties.befund.label')).toEqual({
      de: 'Befund (Freitext)',
      en: 'Finding (free text)',
    });
    expect(getAt(eff.file, 'tasks.kontrolle.label')).toEqual({
      de: 'Regelkontrolle',
      en: 'Routine inspection',
    });
    expect(getAt(eff.file, 'inputs.kontrollintervall_monate.default')).toBe(18);
    expect(getAt(eff.file, 'tasks.erfassung_import')).toBeUndefined();
    expect(getAt(eff.file, 'types.baum.properties.patenschaft.type')).toBe('text');
  });

  it('the major step ships the migration that names the renamed option', () => {
    expect(v200.migrations?.['1 -> 2']).toBeDefined();
    const kinds = breakingChanges(v110, v200).map((b) => b.kind);
    expect(kinds).toContain('option_removed'); // stage.options.kontrolliert: allowed only in a major
  });
});

describe('golden: publishing and overlays', () => {
  it('refuses the 1.2.0 candidate: a select option was removed', () => {
    const candidate = golden('candidates/baumkataster/1.2.0.yaml') as TemplateFile;
    expect(breakingChanges(v110, candidate).map((b) => [b.kind, b.path])).toEqual([
      ['option_removed', 'types.baum.properties.vitalitaet.options.v4'],
    ]);
  });

  it('reports the overlay that touches a locked path', () => {
    const r = merge(v110, project('musterstadt-locked-violation'));
    expect(r.issues.map((i) => i.code)).toContain('lock_violation');
  });

  it('merges the plain project without issues', () => {
    expect(merge(v110, project('musterstadt-plain')).issues).toEqual([]);
  });

  it('a project adds its own automatic action to a locked template task: accepted, compiled, in the table', () => {
    const locked = { ...v110, lock: [...(v110.lock ?? []), 'tasks.massnahme_anlegen'] } as TemplateFile;
    const own = {
      schema: 'ueberblick/1',
      extends: 'baumkataster@1',
      add: { 'tasks.massnahme_anlegen.auto.eigene': { after: 'kontrolle' } },
    } as OverlayFile;
    const r = merge(locked, own);
    expect(r.issues).toEqual([]);
    const c = compile(r.file, { assets: NO_ASSETS });
    expect(c.ok).toBe(true);
    if (c.ok)
      expect([...c.config.autos.keys()]).toEqual(
        expect.arrayContaining(['massnahme_anlegen.massnahme_bei_schaden', 'massnahme_anlegen.eigene']),
      );
    // the template's own entry stays locked: changing or hiding it is refused
    const own2 = {
      schema: 'ueberblick/1',
      extends: 'baumkataster@1',
      override: { 'tasks.massnahme_anlegen.auto.massnahme_bei_schaden.after': 'melden' },
      hide: ['tasks.massnahme_anlegen.auto.massnahme_bei_schaden'],
    } as OverlayFile;
    expect(merge(locked, own2).issues.map((i) => i.code)).toEqual(['lock_violation', 'lock_violation']);
  });
});
