import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from 'yaml';
import { merge, type OverlayFile, type TemplateFile } from '@ueberblick/core';
import { buildPlan } from './plan';
import { resolveUpgrade, startUpgrade, RESOLUTIONS, type UpgradeInput } from './upgrade';

const golden = (rel: string): unknown =>
  parse(readFileSync(resolve(import.meta.dirname, '../../../../../fixtures/golden', rel), 'utf8')) as unknown;
const v110 = golden('templates/baumkataster/1.1.0.yaml') as TemplateFile;
const v200 = golden('templates/baumkataster/2.0.0.yaml') as TemplateFile;
const overlay = golden('projects/musterstadt-baeume.yaml') as OverlayFile;

const input: UpgradeInput = { old: v110, overlay, next: v200 };
const conflictPath = 'types.baum.properties.vitalitaet.label';

/** 2.0.0 without the task the overlay relabels: a removal no migration names (upgrade table row 4). */
const withoutTask = (): UpgradeInput => {
  const next = structuredClone(v200) as unknown as { tasks: Record<string, unknown>; migrations?: unknown };
  delete next.tasks['kontrolle'];
  delete next.migrations;
  return { old: v110, overlay, next: next as unknown as TemplateFile };
};

describe('upgrade wizard: golden upgrade_v1_to_v2', () => {
  it('shows the one conflict, the automatic changes and the kept entries of the scenario', () => {
    const s = startUpgrade(input);
    expect(s.conflicts.map((c) => c.path)).toEqual([conflictPath]);
    expect(s.autoApplied).toEqual(
      expect.arrayContaining([
        'types.baum.properties.befund.label',
        'types.baum.properties.stage.options',
        'tasks.kontrolle.then',
      ]),
    );
    expect(s.unresolved).toEqual([]);
  });

  it('is blocked until the conflict is resolved (first attempt of the scenario)', () => {
    const r = resolveUpgrade(input, { conflicts: {}, unresolved: {} });
    expect(r).toEqual({ ok: false, pending: [conflictPath] });
  });

  it('resolving with the overlay keeps the overlay value (step s2)', () => {
    const r = resolveUpgrade(input, { conflicts: { [conflictPath]: 'overlay' }, unresolved: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.overlay.extends).toBe('baumkataster@2');
    expect(r.overlay.override?.[conflictPath]).toEqual({ de: 'Vitalität (Roloff)', en: 'Vitality (Roloff)' });
    expect(r.issues).toEqual([]);
    expect(parse(r.text)).toEqual(r.overlay);
    const eff = merge(v200, r.overlay).file;
    expect(eff.types?.['baum']?.properties?.['vitalitaet']?.label).toEqual({
      de: 'Vitalität (Roloff)',
      en: 'Vitality (Roloff)',
    });
  });

  it('resolving with the template drops the overlay entry, so the new template value shows', () => {
    const r = resolveUpgrade(input, { conflicts: { [conflictPath]: 'template' }, unresolved: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.overlay.override?.[conflictPath]).toBeUndefined();
    const eff = merge(v200, r.overlay).file;
    expect(eff.types?.['baum']?.properties?.['vitalitaet']?.label).toEqual({
      de: 'Vitalität (Stufe)',
      en: 'Vitality (level)',
    });
  });

  it('the result feeds the same plan view as a deploy (diff against the running version)', () => {
    const r = resolveUpgrade(input, { conflicts: { [conflictPath]: 'overlay' }, unresolved: {} });
    if (!r.ok) throw new Error('expected ok');
    const deployed = merge(v110, overlay).file;
    const plan = buildPlan({ deployed, effective: merge(v200, r.overlay).file, featureCounts: {} });
    expect(plan.entries.length).toBeGreaterThan(0);
  });
});

describe('upgrade wizard: an unresolved removal', () => {
  it('lists the overlay entry whose target the new template removed', () => {
    const s = startUpgrade(withoutTask());
    expect(s.unresolved).toContain('tasks.kontrolle.label');
  });

  it('blocks until dropped, and dropping clears the merge problems; keeping reports them', () => {
    const inp = withoutTask();
    const blocked = resolveUpgrade(inp, { conflicts: { [conflictPath]: 'overlay' }, unresolved: {} });
    expect(blocked).toEqual({ ok: false, pending: ['tasks.kontrolle.label'] });
    const dropped = resolveUpgrade(inp, {
      conflicts: { [conflictPath]: 'overlay' },
      unresolved: { 'tasks.kontrolle.label': 'drop' },
    });
    expect(dropped.ok && dropped.overlay.override?.['tasks.kontrolle.label']).toBeUndefined();
    expect(dropped.ok && dropped.issues).toEqual([]);
    const kept = resolveUpgrade(inp, {
      conflicts: { [conflictPath]: 'overlay' },
      unresolved: { 'tasks.kontrolle.label': 'keep' },
    });
    expect(kept.ok && kept.issues.map((i) => i.path)).toContain('tasks.kontrolle.label');
  });

  it('drops an input the new template no longer declares', () => {
    const inp = withoutTask();
    const next = structuredClone(inp.next) as unknown as { inputs: Record<string, unknown> };
    delete next.inputs['kontrollintervall_monate'];
    const s = startUpgrade({ ...inp, next: next as unknown as TemplateFile });
    expect(s.unresolved).toContain('inputs.kontrollintervall_monate');
    const r = resolveUpgrade(
      { ...inp, next: next as unknown as TemplateFile },
      {
        conflicts: { [conflictPath]: 'overlay' },
        unresolved: { 'tasks.kontrolle.label': 'drop', 'inputs.kontrollintervall_monate': 'drop' },
      },
    );
    expect(r.ok && r.overlay.inputs).toBeUndefined();
  });
});

describe('upgrade wizard: properties', () => {
  it('any choice for the conflict gives an overlay that merges without issues', () => {
    fc.assert(
      fc.property(fc.constantFrom(...RESOLUTIONS), (choice) => {
        const r = resolveUpgrade(input, { conflicts: { [conflictPath]: choice }, unresolved: {} });
        expect(r.ok && r.issues).toEqual([]);
      }),
    );
  });
});
