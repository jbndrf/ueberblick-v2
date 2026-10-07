// WP-352: Farbe, Symbol and Bestätigung write `button` and `confirm`.
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { musterstadt } from '../../testing/golden';
import { buttonOps, confirmOps, confirmTextOps } from './button-ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const T = 'kontrolle';

function commit(doc: Doc, ops: readonly Op[]): Doc {
  const plan = planEdit(doc, ops, `tasks.${T}`, 'de');
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const r = applyOps(doc, plan.ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}
const task = (doc: Doc) => doc.effective().tasks?.[T];

describe('Farbe, Symbol, Bestätigung', () => {
  it('a named colour and a hex colour are written; an empty one is removed', () => {
    let doc = commit(open(), buttonOps(open(), T, 'color', 'danger'));
    expect(task(doc)?.button).toEqual({ color: 'danger' });
    doc = commit(doc, buttonOps(doc, T, 'color', '#3b82f6'));
    expect(task(doc)?.button).toEqual({ color: '#3b82f6' });
    doc = commit(doc, buttonOps(doc, T, 'color', ''));
    expect(task(doc)?.button?.color).toBeUndefined();
  });

  it('a colour that is neither a registry key nor #rrggbb is refused', () => {
    const doc = open();
    expect(planEdit(doc, buttonOps(doc, T, 'color', 'pink'), `tasks.${T}`, 'de').ok).toBe(false);
  });

  it('the icon is written next to the colour', () => {
    let doc = commit(open(), buttonOps(open(), T, 'color', 'success'));
    doc = commit(doc, buttonOps(doc, T, 'icon', 'triangle-alert'));
    expect(task(doc)?.button).toEqual({ color: 'success', icon: 'triangle-alert' });
    expect(planEdit(doc, buttonOps(doc, T, 'icon', 'Not An Icon'), `tasks.${T}`, 'de').ok).toBe(false);
  });

  it('"Bestätigung verlangen" writes `confirm` with a standard text; the message edits it; off removes it', () => {
    let doc = commit(open(), confirmOps(open(), T, 'de', true, 'Wirklich ausführen?'));
    expect(task(doc)?.confirm).toEqual({ de: 'Wirklich ausführen?' });
    doc = commit(doc, confirmTextOps(doc, T, 'de', 'Baum wirklich kontrollieren?'));
    expect(task(doc)?.confirm).toEqual({ de: 'Baum wirklich kontrollieren?' });
    expect(confirmTextOps(doc, T, 'de', '  ')).toEqual([]);
    doc = commit(doc, confirmOps(doc, T, 'de', false, ''));
    expect(task(doc)?.confirm).toBeUndefined();
  });
});
