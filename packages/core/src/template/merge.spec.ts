import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { emptyOverlay, overlay, template1 } from './fixtures';
import { merge } from './merge';
import { getAt } from './paths';
import { upgrade } from './upgrade';

describe('merge, info pages (WP-660)', () => {
  const page = (t: string) => ({ title: t, content: `<p>${t}</p>` });
  it('an overlay adds the first page, overrides one and removes one', () => {
    const added = merge(
      template1,
      overlay({ add: { 'info_pages.a': page('A'), 'info_pages.b': page('B') } }),
    );
    expect(added.issues).toEqual([]);
    expect(getAt(added.file, 'info_pages.a')).toEqual(page('A'));
    const withPages = { ...template1, info_pages: { a: page('A'), b: page('B') } };
    const r = merge(withPages, overlay({ override: { 'info_pages.a': page('A2') }, hide: ['info_pages.b'] }));
    expect(r.issues).toEqual([]);
    expect(getAt(r.file, 'info_pages.a')).toEqual(page('A2'));
    expect(getAt(r.file, 'info_pages.b')).toBeUndefined();
  });
});

describe('merge', () => {
  it('returns the template for an empty overlay, without sharing references', () => {
    const r = merge(template1, emptyOverlay);
    expect(r.file).toEqual(template1);
    expect(r.file).not.toBe(template1);
    expect(r.issues).toEqual([]);
    expect(r.provenance.size).toBe(0);
  });

  it('applies override, add and hide and records provenance', () => {
    const r = merge(
      template1,
      overlay({
        override: { 'types.baum.properties.vitalitaet.label': { de: 'Vitalitaet (Roloff)' } },
        add: {
          'types.baum.properties.patenschaft': { type: 'text', label: 'Patenschaft' },
          'views.paten': { source: { type: 'baum' } },
        },
        hide: ['tasks.kontrolle', 'tasks.melden.auto.nachkontrolle'],
      }),
    );
    expect(r.issues).toEqual([]);
    expect(getAt(r.file, 'types.baum.properties.vitalitaet.label')).toEqual({ de: 'Vitalitaet (Roloff)' });
    expect(getAt(r.file, 'types.baum.properties.patenschaft.type')).toBe('text');
    expect(getAt(r.file, 'tasks.kontrolle')).toBeUndefined();
    expect(getAt(r.file, 'tasks.melden')).toBeDefined();
    expect(r.provenance.get('types.baum.properties.vitalitaet.label')).toBe('changed');
    expect(r.provenance.get('views.paten')).toBe('added');
  });

  it('applies input values as the default of the input', () => {
    const r = merge(template1, overlay({ inputs: { intervall: 18 } }));
    expect(getAt(r.file, 'inputs.intervall.default')).toBe(18);
    expect(r.provenance.get('inputs.intervall.default')).toBe('changed');
  });

  it('reports unknown inputs and unknown paths', () => {
    const r = merge(
      template1,
      overlay({
        inputs: { nope: 1 },
        override: { 'types.baum.properties.weg.label': 'x' },
        hide: ['tasks.weg'],
        add: { 'types.zwischen.properties.x': { type: 'text' } },
      }),
    );
    expect(r.issues.map((i) => [i.code, i.path])).toEqual([
      ['unknown_path', 'inputs.nope'],
      ['unknown_path', 'types.baum.properties.weg.label'],
      ['unknown_path', 'types.zwischen.properties.x'],
      ['unknown_path', 'tasks.weg'],
    ]);
  });

  it('refuses to add over an existing path', () => {
    const r = merge(template1, overlay({ add: { 'tasks.melden': { label: 'x', on: 'baum' } } }));
    expect(r.issues.map((i) => i.code)).toEqual(['path_exists']);
    expect(getAt(r.file, 'tasks.melden.label')).toBe('Melden');
  });

  it('creates a missing top-level section when adding an entity', () => {
    const bare = { ...template1, views: undefined };
    delete (bare as { views?: unknown }).views;
    const r = merge(bare, overlay({ add: { 'views.neu': { source: { type: 'baum' } } } }));
    expect(r.issues).toEqual([]);
    expect(getAt(r.file, 'views.neu.source.type')).toBe('baum');
  });

  it('adds a map layer to a template that has no map section', () => {
    const osm = { label: { de: 'Straße' }, kind: 'base', source: { type: 'preset', preset: 'osm' } };
    const r = merge(template1, overlay({ add: { 'map.layers.osm': osm, 'map.start': { zoom: 12 } } }));
    expect(r.issues).toEqual([]);
    expect(getAt(r.file, 'map.layers.osm.kind')).toBe('base');
    expect(getAt(r.file, 'map.start.zoom')).toBe(12);
    expect(r.provenance.get('map.layers.osm')).toBe('added');
  });

  it('adds a layer next to the layers a template already has', () => {
    const base = {
      ...template1,
      map: { layers: { a: { label: 'A', kind: 'base', source: { type: 'preset', preset: 'osm' } } } },
    };
    const wms = {
      label: 'W',
      kind: 'overlay',
      source: { type: 'wms', url: 'https://x.test/wms', layers: 'l' },
    };
    const r = merge(base as never, overlay({ add: { 'map.layers.w': wms } }));
    expect(r.issues).toEqual([]);
    expect(Object.keys(getAt(r.file, 'map.layers') as object)).toEqual(['a', 'w']);
  });

  describe('lock', () => {
    it('reports overrides, adds and hides that touch a locked path, and skips them', () => {
      const r = merge(
        template1,
        overlay({
          override: { 'types.baum.properties.stage.options.erfasst': 'Neu' },
          add: { 'types.baum.properties.stage.options.extra': 'Extra' },
          hide: ['types.baum.properties.stage'],
        }),
      );
      expect(r.issues.map((i) => [i.code, i.path])).toEqual([
        ['lock_violation', 'types.baum.properties.stage.options.erfasst'],
        ['lock_violation', 'types.baum.properties.stage.options.extra'],
        ['lock_violation', 'types.baum.properties.stage'],
      ]);
      expect(r.file).toEqual(template1);
    });

    it('also catches replacing an ancestor of a locked path', () => {
      const r = merge(template1, overlay({ override: { 'types.baum': { label: 'x', properties: {} } } }));
      expect(r.issues.map((i) => i.code)).toEqual(['lock_violation']);
    });

    it('lets untouched siblings through', () => {
      const r = merge(template1, overlay({ add: { 'types.baum.properties.stage.default': 'erfasst' } }));
      expect(r.issues).toEqual([]);
    });

    // C-004 (owner rule): a lock stops a project from changing or removing what the template defines, not from adding
    // its own automatic action `tasks.<t>.auto.<new>`.
    const ADD = { 'tasks.kontrolle.auto.mein_eintrag': { after: 'melden' } };
    it('adds an automatic action to a template task that is not locked', () => {
      const r = merge(template1, overlay({ add: ADD }));
      expect(r.issues).toEqual([]);
      expect(getAt(r.file, 'tasks.kontrolle.auto.mein_eintrag.after')).toBe('melden');
      expect(r.provenance.get('tasks.kontrolle.auto.mein_eintrag')).toBe('added');
    });
    it('adds its own automatic action to a task locked as a whole, or any ancestor', () => {
      for (const lock of ['tasks.kontrolle', 'tasks']) {
        const r = merge({ ...template1, lock: [lock] }, overlay({ add: ADD }));
        expect(r.issues).toEqual([]);
        expect(getAt(r.file, 'tasks.kontrolle.auto.mein_eintrag.after')).toBe('melden');
      }
    });
    it('still refuses a lock on the new entry itself, and a change or removal of the task itself', () => {
      const own = merge({ ...template1, lock: ['tasks.kontrolle.auto.mein_eintrag'] }, overlay({ add: ADD }));
      expect(own.issues.map((i) => i.code)).toEqual(['lock_violation']);
      const whole = { ...template1, lock: ['tasks.kontrolle'] };
      const r = merge(
        whole,
        overlay({ override: { 'tasks.kontrolle.label': 'x' }, hide: ['tasks.kontrolle'] }),
      );
      expect(r.issues.map((i) => i.code)).toEqual(['lock_violation', 'lock_violation']);
    });
    it('refuses to change or remove a template automatic action under a locked task', () => {
      const whole = { ...template1, lock: ['tasks.melden'] };
      const changed = merge(
        whole,
        overlay({ override: { 'tasks.melden.auto.nachkontrolle.after': 'melden' } }),
      );
      expect(changed.issues.map((i) => [i.code, i.path])).toEqual([
        ['lock_violation', 'tasks.melden.auto.nachkontrolle.after'],
      ]);
      const removed = merge(whole, overlay({ hide: ['tasks.melden.auto.nachkontrolle'] }));
      expect(removed.issues.map((i) => [i.code, i.path])).toEqual([
        ['lock_violation', 'tasks.melden.auto.nachkontrolle'],
      ]);
      const re = merge(whole, overlay({ add: { 'tasks.melden.auto.nachkontrolle': { after: 'melden' } } }));
      expect(re.issues.map((i) => i.code)).toEqual(['lock_violation']);
    });
    it('a lock on one automatic action leaves the others of the task to the project', () => {
      const locked = { ...template1, lock: ['tasks.melden.auto.nachkontrolle'] };
      const r = merge(
        locked,
        overlay({ add: ADD, override: { 'tasks.melden.auto.nachkontrolle.after': 'melden' } }),
      );
      expect(r.issues.map((i) => [i.code, i.path])).toEqual([
        ['lock_violation', 'tasks.melden.auto.nachkontrolle.after'],
      ]);
    });
  });

  describe('hide keeps references valid', () => {
    it('removes hidden entities from the effective config', () => {
      const r = merge(template1, overlay({ hide: ['types.baum.properties.befund'] }));
      expect(getAt(r.file, 'types.baum.properties.befund')).toBeUndefined();
    });

    it('reports nothing when nobody uses the hidden entity', () => {
      const r = merge(template1, overlay({ hide: ['tasks.melden.auto.nachkontrolle', 'tools.photo'] }));
      expect(r.issues.map((i) => i.code)).toEqual(['hidden_referenced']); // photo is in the role app
      expect(r.issues[0]?.path).toBe('roles.kontrolle.app.tools');
      const ok = merge(template1, overlay({ hide: ['tasks.melden.auto.nachkontrolle'] }));
      expect(ok.issues).toEqual([]);
    });

    it('reports a hidden task used by an automatic action', () => {
      const r = merge(template1, overlay({ hide: ['tasks.kontrolle'] }));
      expect(r.issues.map((i) => i.path)).toEqual(['tasks.melden.auto.nachkontrolle.after']);
      expect(r.issues.every((i) => i.code === 'hidden_referenced')).toBe(true);
    });

    it('reports a hidden task used by a role shortcut; its own automatic actions go with it', () => {
      const r = merge(template1, overlay({ hide: ['tasks.melden'] }));
      expect(r.issues.map((i) => i.path)).toEqual(['roles.kontrolle.app.shortcuts']);
    });

    it('hides one automatic action of a task and keeps the task', () => {
      const r = merge(template1, overlay({ hide: ['tasks.melden.auto.nachkontrolle'] }));
      expect(r.issues).toEqual([]);
      expect(getAt(r.file, 'tasks.melden')).toBeDefined();
      expect(getAt(r.file, 'tasks.melden.auto.nachkontrolle')).toBeUndefined();
    });

    it('reports a hidden view used as home and by a role', () => {
      const r = merge(template1, overlay({ hide: ['views.karte'] }));
      expect(r.issues.map((i) => i.path).sort()).toEqual([
        'roles.kontrolle.app.home',
        'roles.kontrolle.app.views',
      ]);
    });

    it('reports a hidden property used in a form, a sort and a write permission', () => {
      const r = merge(template1, overlay({ hide: ['types.baum.properties.vitalitaet'] }));
      expect(r.issues.map((i) => i.path).sort()).toEqual([
        'tasks.kontrolle.form.vitalitaet',
        'types.baum.permissions.write.vitalitaet',
        'views.karte.sort',
      ]);
    });

    it('reports a hidden type used by tasks and views', () => {
      const r = merge({ ...template1, lock: [] }, overlay({ hide: ['types.baum'] }));
      expect(r.issues.map((i) => i.path).sort()).toEqual([
        'tasks.kontrolle.on',
        'tasks.melden.on',
        'views.karte.source.type',
      ]);
    });

    it('is fine when the overlay hides the users together with the entity', () => {
      const r = merge(
        template1,
        overlay({
          hide: ['tasks.melden'],
          override: { 'roles.kontrolle.app.shortcuts': [] },
        }),
      );
      expect(r.issues).toEqual([]);
    });
  });

  it('property: merge(t, {}) equals t for generated templates', () => {
    const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,5}$/);
    fc.assert(
      fc.property(fc.dictionary(key, fc.constantFrom('text', 'date', 'number'), { maxKeys: 6 }), (props) => {
        const t = {
          ...template1,
          types: {
            baum: {
              label: 'Baum',
              properties: Object.fromEntries(Object.entries(props).map(([k, type]) => [k, { type }])),
            },
          },
        };
        const r = merge(t as never, emptyOverlay);
        expect(r.file).toEqual(t);
        expect(r.issues).toEqual([]);
      }),
    );
  });

  it('property: upgrade(t, o, t) leaves an overlay whose merge equals merge(t, o)', () => {
    const value = fc.oneof(fc.string(), fc.integer(), fc.boolean());
    const overrideKeys = ['types.baum.properties.befund.label', 'types.baum.label', 'tasks.melden.label'];
    fc.assert(
      fc.property(
        fc.dictionary(fc.constantFrom(...overrideKeys), value, { maxKeys: 3 }),
        fc.boolean(),
        fc.option(fc.integer(), { nil: undefined }),
        (override, hideRule, interval) => {
          const o = overlay({
            override,
            hide: hideRule ? ['tasks.melden.auto.nachkontrolle'] : [],
            ...(interval === undefined ? {} : { inputs: { intervall: interval } }),
          });
          const up = upgrade(template1, o, template1);
          expect(up.conflicts).toEqual([]);
          expect(up.unresolved).toEqual([]);
          expect(up.autoApplied).toEqual([]);
          expect(merge(template1, up.overlay)).toEqual(merge(template1, o));
        },
      ),
    );
  });
});
