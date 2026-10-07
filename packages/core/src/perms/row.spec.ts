import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PERM_SUBJECT_KINDS } from '../registry';
import type { Actor, Key } from '../model';
import { parseSubject, rolesOfSubjects, roleSubject } from './actor';
import { compilePerms } from './index';
import type { TypePerms } from './contract';
import { ROLES, actor, ctxFor, feature, world } from './__fixtures__/world';

const perms = compilePerms(world());
const T = (t: string): TypePerms => {
  const p = perms.forType(t as Key);
  if (p === undefined) throw new Error(`no type ${t}`);
  return p;
};

describe('subject to role inverse', () => {
  it('is total over PERM_SUBJECT_KINDS: every kind parses and yields a contribution', () => {
    for (const kind of PERM_SUBJECT_KINDS.keys) {
      expect(parseSubject(`${kind}:k`)).toEqual({ kind, key: 'k' });
      expect(Array.isArray(rolesOfSubjects([`${kind}:k`]))).toBe(true);
    }
  });
  it('inverts roleSubject', () => {
    expect(rolesOfSubjects(['role:a', 'role:b', 'role:a'])).toEqual(['a', 'b']);
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', 'b', 'c')), (rs) => {
        expect(new Set(rolesOfSubjects(rs.map(roleSubject)))).toEqual(new Set(rs));
      }),
    );
  });
  it('rejects unknown kinds and malformed subjects', () => {
    expect(parseSubject('nope:x')).toBeUndefined();
    expect(parseSubject('role:')).toBeUndefined();
    expect(parseSubject('role')).toBeUndefined();
    expect(rolesOfSubjects(['role:a', 'nope:x'])).toBeUndefined();
    expect(rolesOfSubjects(['role'])).toBeUndefined();
  });
});

describe('canSeeRow', () => {
  const ids = ['u1', 'u2'];
  const props = fc.record({
    zustaendig: fc.option(fc.constantFrom(...ids), { nil: undefined }),
    stage: fc.option(fc.constantFrom('offen', 'zu'), { nil: undefined }),
  });
  it('agrees with canSee for the actor with that identity and subjects (ids matching and not matching the feature)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('baum', 'flaeche', 'meldung', 'geheim'),
        props,
        fc.subarray([...ROLES]),
        fc.subarray([...ROLES]),
        fc.constantFrom(...ids, 'u3'),
        fc.constantFrom('participant', 'admin', 'system', 'import'),
        (type, p, roles, otherRoles, uid, kind) => {
          const defined = Object.entries(p).flatMap(([k, v]) => (v === undefined ? [] : [[k, v] as const]));
          const f = feature('f1', type, Object.fromEntries(defined));
          const a: Actor = { ...actor(roles, uid), kind };
          const s = perms.subjects(a);
          const want = T(type).canSee(s, f, ctxFor(a, [f]));
          // the ctx carries a different actor: it must be ignored
          const got = T(type).canSeeRow(s, { id: uid, kind }, f, ctxFor(actor(otherRoles, 'zz'), [f]));
          expect(got).toEqual(want);
        },
      ),
      { numRuns: 400 },
    );
  });
  it('a visible_when over actor.id depends on the identity the caller passes', () => {
    const f = feature('f', 'baum', { zustaendig: 'u1' });
    const ctx = ctxFor(actor([]), [f]);
    const s = ['role:bauhof'];
    expect(T('baum').canSeeRow(s, { id: 'u1', kind: 'participant' }, f, ctx).ok).toBe(true);
    expect(T('baum').canSeeRow(s, { id: 'probe', kind: 'participant' }, f, ctx).ok).toBe(false);
  });
  it('reads roles from the subjects, not from the ctx actor', () => {
    const f = feature('f', 'meldung', { stage: 'offen' });
    const ctx = ctxFor(actor(['kontrolle']), [f]);
    const id = { id: 'p', kind: 'participant' } as const;
    expect(T('meldung').canSeeRow(['role:kontrolle'], id, f, ctx).ok).toBe(true);
    expect(T('meldung').canSeeRow(['role:bauhof'], id, f, ctx).ok).toBe(false);
  });
  it('denies malformed subjects with subject_invalid, never silently', () => {
    const f = feature('f', 'flaeche');
    const ctx = ctxFor(actor([]), [f]);
    for (const bad of [['nope:x'], ['role'], ['role:'], ['role:kontrolle', 'x:y']]) {
      const d = T('flaeche').canSeeRow(bad, { id: 'p', kind: 'participant' }, f, ctx);
      expect(d).toEqual({ ok: false, denial: 'subject_invalid' });
    }
  });
});
