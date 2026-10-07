import { describe, expect, it } from 'vitest';
import { ENV } from '../__fixtures__/check-cases';
import { evaluate } from '../evaluate';
import { parse } from '../parse';
import { check, type Env } from '.';

/** Names that exist on every plain object; in the rule language they are ordinary names. */
const PROTO = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'] as const;

function codes(src: string, env: Env = ENV): string[] {
  const p = parse(src);
  if (!p.ok) return p.errors.map((e) => e.code ?? '');
  const r = check(p.ast, env);
  return r.ok ? [] : r.errors.map((e) => e.code ?? '');
}

describe('prototype names are ordinary unknown names', () => {
  for (const n of PROTO) {
    it(`${n}: same registry error as an unknown name`, () => {
      expect(codes(n)).toEqual(codes('zzzUnknown'));
      expect(codes(`${n}()`)).toEqual(codes('zzzUnknown()'));
      expect(codes(`self.${n}`)).toEqual(codes('self.zzzUnknown'));
      expect(codes(`self.${n}()`)).toEqual(codes('self.zzzUnknown()'));
      expect(codes(`-${n}`)).toEqual(codes('-zzzUnknown'));
      expect(codes(`{'a': 1}.${n}`)).not.toContain('');
    });
  }

  it('a feature type named like a prototype member is as unknown as any other', () => {
    const withType = (type: string): Env => ({ ...ENV, vars: { ...ENV.vars, f: { kind: 'feature', type } } });
    expect(codes('f.x', withType('toString'))).toEqual(codes('f.x', withType('zzzType')));
    expect(codes('f.x', withType('toString'))[0]).toBe('unknown_feature_type');
  });

  it('a map literal keyed __proto__ stays an own key and evaluates', () => {
    const p = parse("{'__proto__': {'a': 1}}['__proto__']");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = check(p.ast, ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = evaluate(r.typed, {
      vars: new Map(),
      features: { type: () => undefined, property: () => undefined, related: () => [] },
    } as never);
    expect(res).toEqual({ ok: true, value: { a: 1 } });
  });
});
