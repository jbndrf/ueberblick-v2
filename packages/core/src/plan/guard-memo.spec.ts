// WP-817: the guarded context memoises a feature's `see` verdict per context; it answers as the plain check does.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formApi } from '../form';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import { World, actor, build, fid, ports } from './__fixtures__/world';

const config = build({
  schema: 'ueberblick/1',
  template: { key: 'guardmemo', version: '1.0.0' },
  roles: { kontrolle: { label: 'Kontrolle' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', visible_when: "self.status != 'geheim'" },
      properties: { status: { type: 'text' } },
    },
  },
});

describe('guarded context memo', () => {
  it('repeated reads equal the unmemoised verdict, whatever the order and repetition', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('ok', 'geheim', 'krank'), { minLength: 1, maxLength: 8 }),
        fc.array(fc.nat(7), { minLength: 1, maxLength: 30 }),
        (statuses, reads) => {
          const w = new World(config);
          statuses.forEach((s, i) => w.add(fid(i + 1), 'baum', { status: s }));
          const a = actor('participant', 'u1', ['kontrolle']);
          const perms = compilePerms(config);
          const ctx = createPlan(formApi).contextFor({ none: true }, a, oneVersion(config, perms), ports(w));
          for (const r of reads) {
            const i = r % statuses.length;
            const expected = statuses[i] === 'geheim' ? undefined : statuses[i];
            expect(ctx.features.property(fid(i + 1), 'status')).toBe(expected);
          }
          expect(ctx.features.type(fid(statuses.length + 5))).toBeUndefined();
        },
      ),
    );
  });
  it('a fresh context sees a change; one context keeps its verdict', () => {
    const w = new World(config);
    w.add(fid(1), 'baum', { status: 'ok' });
    const a = actor('participant', 'u1', ['kontrolle']);
    const p = ports(w);
    const make = () =>
      createPlan(formApi).contextFor({ none: true }, a, oneVersion(config, compilePerms(config)), p);
    const old = make();
    expect(old.features.property(fid(1), 'status')).toBeDefined(); // the held context keeps its verdict (documented: hold one per pass)
    w.append('10000000-0000-7000-8000-000000000999' as never, [
      { featureId: fid(1), property: 'status', result: 'geheim' },
    ]);
    expect(make().features.property(fid(1), 'status')).toBeUndefined();
    expect(old.features.property(fid(1), 'status')).toBeDefined(); // the held context keeps its verdict (documented: hold one per pass)
  });
});
