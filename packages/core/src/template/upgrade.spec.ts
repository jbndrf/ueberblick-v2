import { describe, expect, it } from 'vitest';
import { breakingChanges } from './breaking';
import { edited, emptyOverlay, overlay, template1 } from './fixtures';
import { merge } from './merge';
import { upgrade } from './upgrade';

const LABEL = 'types.baum.properties.vitalitaet.label';

describe('upgrade: the three-way table', () => {
  it('row 1: a template change the overlay did not touch applies automatically', () => {
    const v2 = edited(
      template1,
      (t) => {
        (t.types?.baum?.properties.befund as { label: string }).label = 'Befund neu';
      },
      '1.1.0',
    );
    const r = upgrade(template1, overlay({ override: { [LABEL]: 'Mein Label' } }), v2);
    expect(r.autoApplied).toEqual(['types.baum.properties.befund.label']);
    expect(r.conflicts).toEqual([]);
    expect(merge(v2, r.overlay).file.types?.baum?.properties.befund).toMatchObject({ label: 'Befund neu' });
  });

  it('does not report the template identity or migrations as auto-applied', () => {
    const r = upgrade(
      template1,
      emptyOverlay,
      edited(template1, () => {}, '1.0.1'),
    );
    expect(r.autoApplied).toEqual([]);
  });

  it('row 2: an overlay change against an untouched template key is kept', () => {
    const v2 = edited(template1, (t) => {
      (t.types?.baum?.properties.befund as { label: string }).label = 'Befund neu';
    });
    const o = overlay({ override: { [LABEL]: 'Mein Label' } });
    const r = upgrade(template1, o, v2);
    expect(r.overlay.override).toEqual({ [LABEL]: 'Mein Label' });
    expect(r.conflicts).toEqual([]);
    expect(merge(v2, r.overlay).file.types?.baum?.properties.vitalitaet).toMatchObject({
      label: 'Mein Label',
    });
  });

  it('row 3: both changed the same key is a conflict; the overlay value is kept', () => {
    const v2 = edited(template1, (t) => {
      (t.types?.baum?.properties.vitalitaet as { label: string }).label = 'Vital';
    });
    const r = upgrade(template1, overlay({ override: { [LABEL]: 'Mein Label' } }), v2);
    expect(r.conflicts).toEqual([{ path: LABEL, base: 'Vitalitaet', theirs: 'Vital', ours: 'Mein Label' }]);
    expect(r.overlay.override?.[LABEL]).toBe('Mein Label');
    expect(r.autoApplied).toEqual([]);
  });

  it('row 3: no conflict when both changed to the same value; the entry becomes redundant', () => {
    const v2 = edited(template1, (t) => {
      (t.types?.baum?.properties.vitalitaet as { label: string }).label = 'Gleich';
    });
    const r = upgrade(template1, overlay({ override: { [LABEL]: 'Gleich' } }), v2);
    expect(r.conflicts).toEqual([]);
    expect(r.overlay.override).toBeUndefined();
  });

  it('row 3: an added path the new template now also defines is a conflict', () => {
    const v2 = edited(template1, (t) => {
      (t.views as Record<string, unknown>).paten = { source: { type: 'baum' } };
    });
    const r = upgrade(
      template1,
      overlay({ add: { 'views.paten': { source: { type: 'baum', filter: 'x' } } } }),
      v2,
    );
    expect(r.conflicts.map((c) => c.path)).toEqual(['views.paten']);
    expect(r.conflicts[0]?.base).toBeUndefined();
  });

  it('row 4: a referenced key removed without a migration is unresolved', () => {
    const v2 = edited(template1, (t) => {
      delete (t.types?.baum?.properties as Record<string, unknown>).vitalitaet;
    });
    const r = upgrade(template1, overlay({ override: { [LABEL]: 'Mein Label' } }), v2);
    expect(r.unresolved).toEqual([LABEL]);
    expect(r.conflicts).toEqual([]);
  });

  it('row 4: a shipped migration that names the path resolves it', () => {
    const v2 = edited(template1, (t) => {
      delete (t.types?.baum?.properties as Record<string, unknown>).vitalitaet;
      (t.types?.baum?.properties as Record<string, unknown>).zustand = { type: 'select' };
      t.migrations = {
        '1 -> 2': [
          {
            rename_property: {
              from: 'types.baum.properties.vitalitaet',
              to: 'types.baum.properties.zustand',
            },
          },
        ],
      };
    });
    v2.template = { key: 'baumkataster', version: '2.0.0' };
    const r = upgrade(template1, overlay({ override: { [LABEL]: 'Mein Label' } }), v2);
    expect(r.unresolved).toEqual([]);
  });

  it('a removed input that the overlay set is unresolved', () => {
    const v2 = edited(template1, (t) => {
      delete t.inputs;
    });
    const r = upgrade(template1, overlay({ inputs: { intervall: 18 } }), v2);
    expect(r.unresolved).toEqual(['inputs.intervall']);
  });

  it('drops a hide whose target the new template already removed', () => {
    const v2 = edited(template1, (t) => {
      delete (t.tasks?.melden as { auto?: unknown }).auto;
    });
    const r = upgrade(template1, overlay({ hide: ['tasks.melden.auto.nachkontrolle', 'tools.photo'] }), v2);
    expect(r.overlay.hide).toEqual(['tools.photo']);
    expect(r.unresolved).toEqual([]);
  });

  it('a hidden entity that the template changed is neither auto-applied nor a conflict', () => {
    const v2 = edited(template1, (t) => {
      (t.tasks?.melden as { label: string }).label = 'Neu';
    });
    const r = upgrade(template1, overlay({ hide: ['tasks.melden'] }), v2);
    expect(r.autoApplied).toEqual([]);
    expect(r.conflicts).toEqual([]);
  });
});

describe('breakingChanges', () => {
  it('finds nothing between identical or purely additive versions', () => {
    const v2 = edited(template1, (t) => {
      (t.types?.baum?.properties as Record<string, unknown>).neu = { type: 'text' };
      (t.types?.baum?.properties.vitalitaet as { options: Record<string, string> }).options['2'] = '2';
    });
    expect(breakingChanges(template1, template1)).toEqual([]);
    expect(breakingChanges(template1, v2)).toEqual([]);
  });

  it('finds removed keys, changed types and removed options', () => {
    const v2 = edited(template1, (t) => {
      delete (t.tasks as Record<string, unknown>).melden;
      delete (t.types?.baum?.properties as Record<string, unknown>).befund;
      (t.types?.baum?.properties.vitalitaet as { type: string }).type = 'text';
      delete (t.types?.baum?.properties.stage as { options: Record<string, string> }).options.erledigt;
    });
    const found = breakingChanges(template1, v2).map((b) => [b.kind, b.path]);
    expect(found).toContainEqual(['key_removed', 'tasks.melden']);
    expect(found).toContainEqual(['key_removed', 'types.baum.properties.befund']);
    expect(found).toContainEqual(['type_changed', 'types.baum.properties.vitalitaet']);
    expect(found).toContainEqual(['option_removed', 'types.baum.properties.stage.options.erledigt']);
    expect(found).toHaveLength(4);
  });

  it('a removed or changed tool is not breaking (A-041); a removed role or type still is', () => {
    const base = edited(template1, (t) => {
      (t as { tools?: unknown }).tools = { chat: {}, search: { sources: ['baum.titel'] } };
    });
    const noTool = edited(base, (t) => {
      delete (t.tools as Record<string, unknown>).chat;
      (t.tools as Record<string, unknown>).search = { sources: [] };
    });
    expect(breakingChanges(base, noTool)).toEqual([]);
    const noType = edited(base, (t) => {
      delete (t.types as Record<string, unknown>).baum;
    });
    expect(breakingChanges(base, noType).map((b) => [b.kind, b.path])).toContainEqual([
      'key_removed',
      'types.baum',
    ]);
  });

  it('flags a removed type once, not once per property', () => {
    const v2 = edited(template1, (t) => {
      delete (t.types as Record<string, unknown>).baum;
    });
    expect(breakingChanges(template1, v2).map((b) => b.path)).toEqual(['types.baum']);
  });
});
