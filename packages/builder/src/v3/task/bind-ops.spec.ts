// WP-458: "Verknüpfte Objekte" writes `tasks.<t>.bind`; only one-relations are offered; removal shows its impact.
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { musterstadt } from '../../testing/golden';
import {
  addBindOps,
  bindCandidates,
  bindImpact,
  bindRows,
  freeBindName,
  removeBindOps,
  renameBindOps,
  setBindOps,
} from './bind-ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function commit(doc: Doc, task: string, ops: readonly Op[] | undefined): Doc {
  if (ops === undefined) throw new Error('refused');
  const plan = planEdit(doc, ops, `tasks.${task}`, 'de');
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const r = applyOps(doc, plan.ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}
const bindOf = (doc: Doc, task: string) => doc.effective().tasks?.[task]?.bind;

describe('the one-relations a bind may use', () => {
  it('lists cardinality-one relations with the target type, not the many ones', () => {
    const c = bindCandidates(open().effective(), 'verschieben', 'baum', 'de');
    expect(c.map((x) => x.relation)).toContain('flaeche');
    expect(c.map((x) => x.relation)).not.toContain('randlage');
    expect(c.map((x) => x.relation)).not.toContain('massnahmen');
    expect(c.find((x) => x.relation === 'flaeche')?.target).toBe('flaeche');
  });

  it('a reference property is offered too', () => {
    const c = bindCandidates(open().effective(), 'massnahme_erledigen', 'baum', 'de');
    expect(c.find((x) => x.relation === 'baum')?.target).toBe('baum');
  });

  it('rows match the declared binds to a candidate', () => {
    const rows = bindRows(open().effective(), 'kontrolle', 'baum', 'de');
    expect(rows.map((r) => [r.name, r.expr, r.candidate?.relation])).toEqual([
      ['area', 'self.flaeche', 'flaeche'],
    ]);
  });
});

describe('add, point, rename, remove', () => {
  const T = 'verschieben';

  it('adds the first bind (makes `bind`), then a second', () => {
    let doc = commit(open(), T, addBindOps(open(), T, 'area', 'self.flaeche'));
    expect(bindOf(doc, T)).toEqual({ area: 'self.flaeche' });
    doc = commit(doc, T, addBindOps(doc, T, 'zone', 'self.flaeche'));
    expect(bindOf(doc, T)).toEqual({ area: 'self.flaeche', zone: 'self.flaeche' });
  });

  it('a many-relation is refused by the checker, so the pane never offers it', () => {
    const doc = open();
    expect(planEdit(doc, addBindOps(doc, T, 'rand', 'self.randlage'), `tasks.${T}`, 'de').ok).toBe(false);
  });

  it('renames a bind that no form entry uses and keeps the expression', () => {
    let doc = commit(open(), T, addBindOps(open(), T, 'area', 'self.flaeche'));
    doc = commit(doc, T, renameBindOps(doc, T, 'area', 'flaeche_neu'));
    expect(bindOf(doc, T)).toEqual({ flaeche_neu: 'self.flaeche' });
    expect(renameBindOps(doc, T, 'flaeche_neu', 'flaeche_neu')).toEqual([]);
    expect(renameBindOps(doc, T, 'nope', 'x')).toEqual([]);
  });

  it('a name that is taken is refused', () => {
    let doc = commit(open(), T, addBindOps(open(), T, 'a', 'self.flaeche'));
    doc = commit(doc, T, addBindOps(doc, T, 'b', 'self.flaeche'));
    expect(renameBindOps(doc, T, 'a', 'b')).toBeUndefined();
    expect(freeBindName(doc.effective(), T, 'a')).toBe('a_2');
    expect(freeBindName(doc.effective(), T, 'a', 'a')).toBe('a');
  });

  it('removes a bind, and `bind` with the last one', () => {
    let doc = commit(open(), T, addBindOps(open(), T, 'a', 'self.flaeche'));
    doc = commit(doc, T, addBindOps(doc, T, 'b', 'self.flaeche'));
    doc = commit(doc, T, removeBindOps(doc, T, 'a'));
    expect(bindOf(doc, T)).toEqual({ b: 'self.flaeche' });
    doc = commit(doc, T, removeBindOps(doc, T, 'b'));
    expect(bindOf(doc, T)).toBeUndefined();
  });

  it('pointing a bind at what it already is changes nothing', () => {
    const doc = commit(open(), T, addBindOps(open(), T, 'a', 'self.flaeche'));
    expect(planEdit(doc, setBindOps(doc, T, 'a', 'self.flaeche'), `tasks.${T}`, 'de')).toEqual({
      ok: false,
      reason: 'no_effect',
    });
  });

  it('removing a bind that a `then` step still uses is stopped by the checker, with its reason', () => {
    const doc = open();
    const ops = removeBindOps(doc, 'kontrolle', 'area') ?? [];
    const plan = planEdit(doc, ops, 'tasks.kontrolle', 'de');
    expect(plan.ok).toBe(false);
  });
});

describe('impact of a bind that form entries use', () => {
  const T = 'kontrolle';
  const withField = (): Doc => {
    const doc = open();
    return commit(doc, T, [{ kind: 'set', path: `tasks.${T}.form["area.name"]`, value: {} }]);
  };

  it('names the fields, and remove and rename are refused', () => {
    const doc = withField();
    expect(bindImpact(doc.effective(), T, 'area')).toEqual(['area.name']);
    expect(removeBindOps(doc, T, 'area')).toBeUndefined();
    expect(renameBindOps(doc, T, 'area', 'gebiet')).toBeUndefined();
  });

  it('no impact once the field is gone', () => {
    expect(bindImpact(open().effective(), T, 'area')).toEqual([]);
  });
});
