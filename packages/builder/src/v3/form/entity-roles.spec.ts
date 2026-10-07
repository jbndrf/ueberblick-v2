// WP-455 (A-051): the entity selector's source "Rollen" writes a `role` property.
import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { messages } from '../../shell/messages';
import { musterstadt } from '../../testing/golden';
import { entityConfigOf, rolesOps, sourceOps } from './entity';
import { placeOps } from './ops';

const T = 'kontrolle';
const TYPE = 'baum';
const t = messages('de');
function apply(doc: Doc, ops: readonly Op[]): Doc {
  let cur = doc;
  for (const op of ops) {
    const r = cur.apply(op);
    expect(r.refused, JSON.stringify(op)).toBeUndefined();
    cur = r.doc;
  }
  return cur;
}
const open = (): Doc => {
  const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
  return apply(doc, placeOps(doc, T, TYPE, 'zustaendig', { kind: 'page', page: 0 }));
};
const prop = (doc: Doc) => doc.effective().types?.[TYPE]?.properties['zustaendig'];

describe('Rollen as a source', () => {
  it('switching to Rollen makes a role property and reads back as roles', () => {
    const doc = open();
    const to = apply(doc, sourceOps(doc, T, TYPE, 'zustaendig', 'roles', ['baumart'], 'de', t));
    expect(prop(to)).toMatchObject({ type: 'role' });
    expect(prop(to)).not.toHaveProperty('select');
    expect(entityConfigOf(to.effective(), T, TYPE, 'zustaendig').source).toBe('roles');
    const known = new Set(doc.problems().map((p) => `${p.code} ${p.path}`));
    expect(to.problems().filter((p) => !known.has(`${p.code} ${p.path}`))).toEqual([]);
  });
  it('keeps Mehrfachauswahl and drops the participant role rule', () => {
    const doc = open();
    const lists = apply(
      doc,
      rolesOps(doc, T, TYPE, 'zustaendig', { any: ['verwaltung'], self: [] }, 'de', t),
    );
    const many = apply(lists, [
      { kind: 'set', path: `types.${TYPE}.properties.zustaendig.cardinality`, value: 'many' } as Op,
    ]);
    const to = apply(many, sourceOps(many, T, TYPE, 'zustaendig', 'roles', ['baumart'], 'de', t));
    expect(prop(to)).toMatchObject({ type: 'role', cardinality: 'many' });
    expect(entityConfigOf(to.effective(), T, TYPE, 'zustaendig').constraint).toEqual({
      foreign: false,
      roles: { any: [], self: [] },
    });
  });
});
