import { describe, expect, it } from 'vitest';
import type { Problem } from '@ueberblick/core';
import { goldenDoc, must } from '../process/fixtures';
import { buildViews } from './model';
import {
  addLayerOp,
  addViewOp,
  removeFilterOp,
  setLayerRendererOp,
  setLayerSourceOp,
  setLayerStyleOp,
  setViewFilterOp,
} from './ops';
import { problemsAt } from './check';

const doc = () => goldenDoc('baumkataster', '2.0.0', false);
const view = (key: string) => must(buildViews(doc(), 'en').find((v) => v.key === key));

describe('buildViews', () => {
  it('lists views with label, source, filter, provenance and layers', () => {
    const all = buildViews(doc(), 'en');
    expect(all.map((v) => v.key)).toEqual(['karte', 'meine_aufgaben', 'alle_baeume']);
    const tasks = view('meine_aufgaben');
    expect(tasks.label).toBe('My tasks');
    expect(tasks.source.type).toBe('baum');
    expect(tasks.source.filter).toContain('self.zustaendig');
    expect(tasks.provenance).toBe('template');
    expect(tasks.layers).toEqual([]);
  });

  it('reads a layer: renderer, own source and a $ref style as a reference', () => {
    // WP-759: the golden layers carry no style (looks are B-024's only feature style), so the $ref is set by an op
    const d = doc().apply(setLayerStyleOp('karte', 'flaechen', { $ref: 'styles/flaeche.json' })).doc;
    const layer = must(
      must(buildViews(d, 'en').find((v) => v.key === 'karte')).layers.find((l) => l.key === 'flaechen'),
    );
    expect(layer.renderer).toBe('maplibre-2d');
    expect(layer.source).toEqual({ kind: 'type', type: 'flaeche' });
    expect(layer.style).toEqual({ kind: 'ref', ref: 'styles/flaeche.json' });
  });

  it('reads an inline style and a layer without one', () => {
    let d = doc();
    const style = { layers: [{ id: 'ub-single', type: 'circle', source: 'ub-clusters' }] };
    d = d.apply(setLayerStyleOp('karte', 'baeume', style)).doc;
    const layer = must(
      must(buildViews(d, 'en').find((v) => v.key === 'karte')).layers.find((l) => l.key === 'baeume'),
    );
    expect(layer.style).toEqual({ kind: 'inline', value: style });
    expect(layer.provenance).toBe('changed');
  });
});

describe('view edits are ops', () => {
  it('sets a view filter and keeps the overlay entry', () => {
    const r = doc().apply(setViewFilterOp('alle_baeume', 'self.faellig_am <= today()'));
    expect(r.refused).toBeUndefined();
    expect(r.doc.effective().views?.alle_baeume?.source.filter).toBe('self.faellig_am <= today()');
    expect(
      r.doc.overlay().add?.['views.alle_baeume.source.filter'] ?? r.doc.overlay().override,
    ).toBeDefined();
  });

  it('removes a filter', () => {
    const r = doc().apply(removeFilterOp('meine_aufgaben'));
    expect(r.doc.effective().views?.meine_aufgaben?.source.filter).toBeUndefined();
  });

  it('checks a filter live: the problem at that path, nothing applied', () => {
    const op = setViewFilterOp('meine_aufgaben', 'self.nope == 1');
    const r = doc().apply(op);
    const problems = problemsAt(r.problems, 'views.meine_aufgaben.source.filter', 'en');
    expect(problems[0]?.message).toMatch(/nope/);
  });

  it('problemsAt ignores problems elsewhere', () => {
    const other: Problem = {
      code: 'x',
      path: 'views.other.source.filter',
      message: { en: 'm' },
    } as unknown as Problem;
    expect(problemsAt([other], 'views.a.source.filter', 'en')).toEqual([]);
  });

  it('changes a layer source with its own filter', () => {
    const r = doc().apply(
      setLayerSourceOp('karte', 'baeume', { type: 'baum', filter: "self.stage == 'massnahme'" }),
    );
    expect(r.refused).toBeUndefined();
    expect(must(r.doc.effective().views?.karte?.layers?.baeume?.source)).toEqual({
      type: 'baum',
      filter: "self.stage == 'massnahme'",
    });
  });

  it('changes the renderer through the registry key, an unknown key is refused by the schema', () => {
    expect(doc().apply(setLayerRendererOp('karte', 'baeume', 'maplibre-2d')).refused).toBeUndefined();
    expect(doc().apply(setLayerRendererOp('karte', 'baeume', 'nope')).refused).toBeDefined();
  });

  it('adds a layer to a view with layers and to one without', () => {
    const a = doc().apply(addLayerOp(view('karte'), 'weg', 'maplibre-2d'));
    expect(a.refused).toBeUndefined();
    expect(a.doc.effective().views?.karte?.layers?.weg?.renderer).toBe('maplibre-2d');
    const b = doc().apply(addLayerOp(view('alle_baeume'), 'punkte', 'maplibre-2d'));
    expect(b.refused).toBeUndefined();
    expect(b.doc.effective().views?.alle_baeume?.layers?.punkte?.renderer).toBe('maplibre-2d');
  });

  it('adds a view', () => {
    const r = doc().apply(addViewOp('paten', 'baum', 'Paten'));
    expect(r.refused).toBeUndefined();
    expect(r.doc.effective().views?.paten?.source.type).toBe('baum');
  });
});
