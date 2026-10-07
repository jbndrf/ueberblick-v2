import fc from 'fast-check';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { OverlayFileSchema } from '../schema';
import { edited, overlay, template1 } from './fixtures';
import { merge } from './merge';
import { getAt } from './paths';
import { upgrade } from './upgrade';

const keys = (file: unknown, path: string): string[] => Object.keys(getAt(file, path) as object);

describe('overlay order', () => {
  it('reorders tasks, properties, form fields and options', () => {
    const t = edited(template1, (c) => {
      const task = c.tasks?.melden;
      if (task) task.form = { befund: {}, vitalitaet: {} };
      const v = c.types?.baum?.properties.vitalitaet;
      if (v && v.type === 'select') v.options = { v0: '0', v1: '1' };
    });
    const r = merge(
      t,
      overlay({
        order: {
          tasks: ['kontrolle', 'melden'],
          'types.baum.properties': ['befund', 'stage'],
          'tasks.melden.form': ['vitalitaet', 'befund'],
          'types.baum.properties.vitalitaet.options': ['v1', 'v0'],
        },
      }),
    );
    expect(r.issues).toEqual([]);
    expect(keys(r.file, 'tasks')).toEqual(['kontrolle', 'melden']);
    expect(keys(r.file, 'types.baum.properties')).toEqual(['befund', 'stage', 'vitalitaet']);
    expect(keys(r.file, 'tasks.melden.form')).toEqual(['vitalitaet', 'befund']);
    expect(keys(r.file, 'types.baum.properties.vitalitaet.options')).toEqual(['v1', 'v0']);
    expect(r.provenance.get('tasks')).toBe('changed');
    expect(r.provenance.get('types.baum.properties')).toBe('changed');
  });

  it('applies order after add and hide', () => {
    const r = merge(
      template1,
      overlay({
        add: { 'types.baum.properties.patenschaft': { type: 'text' } },
        hide: ['tasks.melden.auto.nachkontrolle', 'tasks.kontrolle'],
        order: { 'types.baum.properties': ['patenschaft', 'vitalitaet'], tasks: ['kontrolle', 'melden'] },
      }),
    );
    expect(keys(r.file, 'types.baum.properties')).toEqual(['patenschaft', 'vitalitaet', 'stage', 'befund']);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'unknown_path', path: 'tasks.kontrolle' });
    expect(keys(r.file, 'tasks')).toEqual(['melden']);
  });

  it('may order a map that holds a locked entry, but not a locked path or one below it', () => {
    const r = merge(
      template1,
      overlay({
        order: { 'types.baum.properties': ['befund'], 'types.baum.properties.stage.options': ['x'] },
      }),
    );
    expect(r.issues.map((i) => i.code)).toEqual(['lock_violation']);
    expect(keys(r.file, 'types.baum.properties')[0]).toBe('befund');
  });

  it('reports an unknown key and skips it, without throwing', () => {
    const r = merge(template1, overlay({ order: { tasks: ['weg', 'kontrolle'] } }));
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'unknown_path', path: 'tasks.weg' });
    expect(keys(r.file, 'tasks')).toEqual(['kontrolle', 'melden']);
  });

  it('reports a path that is not a map', () => {
    const r = merge(template1, overlay({ order: { 'tasks.nope': ['a'], 'tasks.melden.label': ['a'] } }));
    expect(r.issues.map((i) => i.code)).toEqual(['unknown_path', 'unknown_path']);
  });

  it('reports a locked path and leaves the order alone', () => {
    const r = merge(template1, overlay({ order: { 'types.baum.properties.stage.options': ['erledigt'] } }));
    expect(r.issues.map((i) => i.code)).toEqual(['lock_violation']);
    expect(keys(r.file, 'types.baum.properties.stage.options')).toEqual(['erfasst', 'erledigt']);
  });

  it('property: the result is a permutation of the input keys', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('melden', 'kontrolle', 'x', 'y', 'z')), (list) => {
        const r = merge(template1, overlay({ order: { tasks: list } }));
        const out = keys(r.file, 'tasks');
        expect([...out].sort()).toEqual(['kontrolle', 'melden']);
        const listed = [...new Set(list)].filter((k) => out.includes(k));
        expect(out.slice(0, listed.length)).toEqual(listed);
      }),
    );
  });

  it('upgrade: added keys follow the ordered ones, removed keys drop out', () => {
    const o = overlay({ order: { 'types.baum.properties': ['befund', 'stage', 'vitalitaet'] } });
    const next = edited(
      template1,
      (c) => {
        const p = c.types?.baum?.properties;
        if (!p) return;
        delete p.vitalitaet;
        p.neu = { type: 'text' };
      },
      '1.1.0',
    );
    const u = upgrade(template1, o, next);
    expect(u.overlay.order).toEqual({ 'types.baum.properties': ['befund', 'stage'] });
    expect(u.unresolved).toEqual([]);
    const r = merge(next, u.overlay);
    expect(r.issues).toEqual([]);
    expect(keys(r.file, 'types.baum.properties')).toEqual(['befund', 'stage', 'neu']);
  });

  it('upgrade: an order entry whose map was removed is dropped', () => {
    const o = overlay({ order: { views: ['karte'] } });
    const next = edited(template1, (c) => delete c.views, '1.1.0');
    expect(upgrade(template1, o, next).overlay.order).toBeUndefined();
  });

  it('upgrade: an unchanged order entry is kept', () => {
    const o = overlay({ order: { tasks: ['kontrolle', 'melden'] } });
    expect(
      upgrade(
        template1,
        o,
        edited(template1, () => {}, '1.1.0'),
      ).overlay.order,
    ).toEqual(o.order);
  });

  it('keeps comments in a YAML round trip and parses', () => {
    const src = [
      'schema: ueberblick/1',
      'extends: baumkataster@1',
      'order:',
      '  # buttons in the sheet',
      '  tasks: [ kontrolle, melden ] # Kontrolle first',
      '',
    ].join('\n');
    const doc = parseDocument(src);
    expect(doc.toString()).toBe(src);
    expect(OverlayFileSchema.safeParse(doc.toJSON()).success).toBe(true);
  });
});
