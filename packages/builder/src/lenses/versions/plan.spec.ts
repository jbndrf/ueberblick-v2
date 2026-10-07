import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { diff, type TemplateFile } from '@ueberblick/core';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { buildPlan, mappingsComplete, missingMappings } from './plan';

/** A mutable view of the parts of the file these specs edit. */
interface Loose {
  types: Record<
    string,
    {
      label: unknown;
      properties: Record<string, { type?: string; options?: Record<string, unknown> }>;
    }
  >;
}

const base = (): TemplateFile => openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective();
const edit = (fn: (f: Loose) => void): TemplateFile => {
  const f = structuredClone(base());
  fn(f as unknown as Loose);
  return f;
};
const baum = (f: Loose) => f.types['baum'] as Loose['types'][string];

describe('buildPlan', () => {
  it('lists exactly the entries of core diff (the plan view equals diff)', () => {
    const next = edit((f) => {
      baum(f).properties['neu'] = { type: 'text' };
      baum(f).label = { de: 'Baum neu', en: 'Tree new' };
    });
    const plan = buildPlan({ deployed: base(), effective: next, featureCounts: {} });
    expect(plan.entries).toEqual(diff(base(), next));
    expect(plan.entities.flatMap((e) => e.changes)).toEqual(plan.entries);
  });

  it('an unchanged file has an empty plan', () => {
    const plan = buildPlan({ deployed: base(), effective: base(), featureCounts: {} });
    expect(plan.entries).toEqual([]);
    expect(plan.entities).toEqual([]);
    expect(plan.mappings).toEqual([]);
  });

  it('groups by section and entity and counts the features of changed types', () => {
    const next = edit((f) => {
      baum(f).label = { de: 'Baum neu', en: 'Tree new' };
    });
    const plan = buildPlan({ deployed: base(), effective: next, featureCounts: { baum: 42 } });
    expect(plan.entities.map((e) => [e.section, e.entity])).toEqual([['types', 'baum']]);
    expect(plan.affected).toEqual([{ type: 'baum', features: 42 }]);
  });

  it('a removed select option needs a mapping whose choices are the remaining options', () => {
    const opts = Object.keys(base().types?.['baum']?.properties?.['vitalitaet']?.options ?? {});
    expect(opts.length).toBeGreaterThan(1);
    const removed = opts[opts.length - 1] as string;
    const next = edit((f) => {
      delete baum(f).properties['vitalitaet']?.options?.[removed];
    });
    const plan = buildPlan({ deployed: base(), effective: next, featureCounts: {} });
    const path = `types.baum.properties.vitalitaet.options.${removed}`;
    expect(plan.breaking.map((e) => e.path)).toContain(path);
    expect(plan.mappings.find((m) => m.path === path)?.choices).toEqual(opts.filter((o) => o !== removed));
  });

  it('a removed property offers its siblings, a changed type only discarding', () => {
    const next = edit((f) => {
      delete baum(f).properties['vitalitaet'];
      (baum(f).properties['art'] as { type: string }).type = 'integer';
    });
    const plan = buildPlan({ deployed: base(), effective: next, featureCounts: {} });
    const removed = plan.mappings.find((m) => m.path === 'types.baum.properties.vitalitaet');
    expect(removed?.choices).toContain('art');
    expect(removed?.choices).not.toContain('vitalitaet');
    expect(plan.mappings.find((m) => m.path === 'types.baum.properties.art.type')?.choices).toEqual([]);
  });

  it('has no mappings when nothing breaks', () => {
    const next = edit((f) => {
      baum(f).properties['neu'] = { type: 'text' };
    });
    expect(buildPlan({ deployed: base(), effective: next, featureCounts: {} }).mappings).toEqual([]);
  });

  it('a first deploy (nothing deployed) lists everything as added and needs no mapping', () => {
    const plan = buildPlan({ deployed: undefined, effective: base(), featureCounts: {} });
    expect(plan.entries.length).toBeGreaterThan(0);
    expect(plan.entries.every((e) => e.change === 'added')).toBe(true);
    expect(plan.mappings).toEqual([]);
  });
});

describe('mappings block the deploy until chosen', () => {
  const next = edit((f) => {
    delete baum(f).properties['vitalitaet'];
  });
  const plan = buildPlan({ deployed: base(), effective: next, featureCounts: {} });
  const path = 'types.baum.properties.vitalitaet';

  it('is incomplete until every request has a valid mapping', () => {
    expect(missingMappings(plan, {})).toEqual([path]);
    expect(mappingsComplete(plan, {})).toBe(false);
    expect(mappingsComplete(plan, { [path]: { to: 'gibt_es_nicht' } })).toBe(false);
    expect(mappingsComplete(plan, { [path]: { to: 'art' } })).toBe(true);
    expect(mappingsComplete(plan, { [path]: { discard: true } })).toBe(true);
  });

  it('property: complete exactly when the mapping is a discard or a listed choice', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.constantFrom('art', 'x', ''), (discard, to) => {
        const chosen = discard ? { [path]: { discard: true as const } } : { [path]: { to } };
        expect(mappingsComplete(plan, chosen)).toBe(discard || to === 'art');
      }),
    );
  });
});
