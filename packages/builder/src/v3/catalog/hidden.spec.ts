// WP-452: hidden template elements in the catalog inventories (pure; the click is in catalog-hidden.ui.spec.ts).
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { buildInventory } from './inventory';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const hideAll = (doc: Doc, paths: string[]): Doc =>
  paths.reduce((d, path) => d.apply({ kind: 'hide', path }).doc, doc);

describe('hidden template elements', () => {
  it('are listed apart from the visible ones, and unhide puts them back', () => {
    const doc = open();
    // The first property the document lets go of (some are used by views or the stage).
    const field =
      Object.keys(doc.template.types?.baum?.properties ?? {}).find(
        (k) => doc.apply({ kind: 'hide', path: `types.baum.properties.${k}` }).refused === undefined,
      ) ?? '';
    expect(field).not.toBe('');
    const hidden = hideAll(doc, [
      'tasks.massnahme_anlegen.auto.massnahme_bei_schaden',
      'tasks.kontrolle',
      `types.baum.properties.${field}`,
    ]);
    const inv = buildInventory(hidden, 'baum', 'de');
    expect(inv.tasks.map((t) => t.key)).not.toContain('kontrolle');
    expect(inv.hiddenTasks.map((t) => t.path)).toEqual(['tasks.kontrolle']);
    expect(inv.hiddenRules.map((r) => r.path)).toEqual([
      'tasks.massnahme_anlegen.auto.massnahme_bei_schaden',
    ]);
    expect(inv.hiddenFields.map((f) => f.path)).toEqual([`types.baum.properties.${field}`]);
    let back = hidden;
    for (const row of [...inv.hiddenTasks, ...inv.hiddenRules, ...inv.hiddenFields])
      back = back.apply({ kind: 'unhide', path: row.path }).doc;
    const again = buildInventory(back, 'baum', 'de');
    expect(again.hiddenTasks).toEqual([]);
    expect(again.tasks.map((t) => t.key)).toContain('kontrolle');
    expect(again.fields.map((f) => f.key)).toContain(field);
  });

  it('another Objektart does not list them, and a project without hides lists none', () => {
    const hidden = hideAll(open(), ['tasks.kontrolle']);
    expect(buildInventory(hidden, 'flaeche', 'de').hiddenTasks).toEqual([]);
    const inv = buildInventory(open(), 'baum', 'de');
    expect([inv.hiddenTasks, inv.hiddenRules, inv.hiddenFields]).toEqual([[], [], []]);
  });
});
