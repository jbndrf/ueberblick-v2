import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARSE_LIMITS, type Expr } from '../ast';
import {
  CHECK_DEVICE_ERR,
  CHECK_ERR,
  CHECK_EXPECT,
  CHECK_OK,
  DEVICE_ENV,
  ENV,
} from '../__fixtures__/check-cases';
import { children, parse } from '../parse';
import { isReservedWord } from '../parse/lexer';
import { T, check, show, type CheckResult, type Env } from '.';

function run(
  src: string,
  env: Env = ENV,
  expect_?: Parameters<typeof check>[2],
): { ast: Expr; result: CheckResult } {
  const p = parse(src);
  if (!p.ok) throw new Error(`parse ${src}: ${p.errors[0]?.message ?? '?'}`);
  return { ast: p.ast, result: check(p.ast, env, expect_) };
}

const nodes = (e: Expr): Expr[] => [e, ...children(e).flatMap(nodes)];

describe('check: well-typed corpus', () => {
  it.each(CHECK_OK)('%s : %s', (src, type) => {
    const { result } = run(src);
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
    expect(show(result.typed.type)).toBe(type);
  });

  it('records a type for every node', () => {
    for (const [src] of CHECK_OK) {
      const { ast, result } = run(src);
      if (!result.ok) continue;
      for (const n of nodes(ast)) expect(result.typed.types.has(n), `${src}: ${n.kind}`).toBe(true);
    }
  });
});

describe('check: rejected corpus', () => {
  it.each(CHECK_ERR)('%s -> %s', (src, fragment, covered) => {
    const { result } = run(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const hit = result.errors.find((e) => e.message.includes(fragment));
    expect(hit, result.errors.map((e) => e.message).join('; ')).toBeDefined();
    if (!hit) return;
    expect(src.slice(hit.span.start, hit.span.end)).toBe(covered);
  });

  it('collects several errors in one expression', () => {
    const { result } = run('self.stag && self.alterr == 1 && foo');
    expect(!result.ok && result.errors.length).toBe(3);
  });

  it('offers a did-you-mean hint for typos', () => {
    const a = run('self.hoeh');
    expect(!a.result.ok && a.result.errors[0]?.hint).toBe("did you mean 'hoehe'?");
    const b = run('selff');
    expect(!b.result.ok && b.result.errors[0]?.hint).toBe("did you mean 'self'?");
    const c = run('startsWth(1)');
    expect(!c.result.ok && c.result.errors[0]?.message).toContain("unknown function 'startsWth'");
  });

  it('lists what is available when nothing is close', () => {
    const { result } = run('self.zzzzzzzzzz');
    expect(!result.ok && result.errors[0]?.hint).toContain('available:');
  });
});

describe('check: expected result type', () => {
  it.each(CHECK_EXPECT)('%s expecting %j', (src, want, message, isOk) => {
    const { result } = run(src, ENV, { expect: want });
    expect(result.ok).toBe(isOk);
    if (!result.ok) expect(result.errors.some((e) => e.message.includes(message))).toBe(true);
  });
});

describe('check: actor.role does not exist (A-009)', () => {
  it('is an error whose hint suggests `in actor.roles`', () => {
    const r = run("actor.role == 'admin'").result;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]?.hint).toBe("use `'<x>' in actor.roles`");
    expect(run("'admin' in actor.roles").result.ok).toBe(true);
  });
});

describe('check: environment', () => {
  it('resolves only the names the environment provides (value is not always in scope)', () => {
    const noValue: Env = { ...ENV, vars: { self: ENV.vars['self'] as never } };
    expect(run('value', noValue).result.ok).toBe(false);
    expect(run('self.stage', noValue).result.ok).toBe(true);
    expect(run('actor.roles', noValue).result.ok).toBe(false);
  });

  it('resolves bind names as related features', () => {
    const env: Env = { ...ENV, vars: { ...ENV.vars, flaeche: { kind: 'feature', type: 'flaeche' } } };
    expect(show(run('flaeche.name', env).result.ok ? T.string : T.dyn)).toBe('string');
    expect(run('flaeche.name == self.flaeche.name', env).result.ok).toBe(true);
  });

  it('reports an unknown feature type instead of crashing', () => {
    const env: Env = { vars: { self: { kind: 'feature', type: 'ghost' } }, features: {} };
    const r = run('self.x', env).result;
    expect(!r.ok && r.errors[0]?.message).toContain("unknown feature type 'ghost'");
  });

  it('supports cyclic relations (a feature type refers to itself by name)', () => {
    const env: Env = {
      vars: { self: { kind: 'feature', type: 'n' } },
      features: { n: { next: { kind: 'feature', type: 'n' }, v: T.int } },
    };
    expect(run('self.next.next.next.v + 1', env).result.ok).toBe(true);
  });

  it('accepts extra registered functions', () => {
    const env: Env = { ...ENV, functions: { twice: [{ params: [T.int], returns: T.int }] } };
    expect(run('twice(self.alter) > 1', env).result.ok).toBe(true);
    expect(run('twice(self.stage)', env).result.ok).toBe(false);
  });

  it('shadows names inside a macro without leaking them', () => {
    expect(run('self.tags.exists(self, self == "a")').result.ok).toBe(true);
    expect(run('self.tags.map(actor, actor.size())').result.ok).toBe(true);
  });

  it('does not mutate the environment or the AST', () => {
    const before = JSON.stringify(ENV);
    const p = parse("self.tags.exists(t, t == 'a') && self.alter > 1");
    if (!p.ok) throw new Error('parse');
    const snap = JSON.stringify(p.ast);
    check(p.ast, ENV);
    expect(JSON.stringify(ENV)).toBe(before);
    expect(JSON.stringify(p.ast)).toBe(snap);
  });
});

describe('check: device history limit', () => {
  it.each(CHECK_DEVICE_ERR)('%s -> %s (device)', (src, fragment) => {
    const { result } = run(src, DEVICE_ENV);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.some((e) => e.message.includes(fragment))).toBe(true);
  });

  it('allows up to the limit on the device and any count on the server', () => {
    expect(run("last('stage', 10)", DEVICE_ENV).result.ok).toBe(true);
    expect(run("last('stage', 100)", ENV).result.ok).toBe(true);
    expect(run("last('stage', self.alter)", ENV).result.ok).toBe(true);
  });
});

describe('check: properties', () => {
  // The accepted members of `self` come from the env's type, not from a hand-kept list.
  const members = Object.keys(ENV.features['baum'] ?? {});
  const known = new Set(members);
  // A name is only a member candidate if `self.<name>` parses: `null`, `true` and `false`
  // are literals and never reach the checker (counterexample: `self.null`).
  const parses = (n: string): boolean => parse(`self.${n}`).ok;

  it('a name that is a literal does not parse as a member (regression: null, true, false)', () => {
    for (const n of ['null', 'true', 'false']) expect(parses(n)).toBe(false);
  });

  it('every declared property resolves and every made-up one is rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...members),
        fc.stringMatching(/^[a-z]{3,8}$/).filter((n) => !isReservedWord(n) && parses(n)),
        (good, bad) => {
          expect(run(`self.${good}`).result.ok).toBe(true);
          expect(run(`self.${bad}`).result.ok, bad).toBe(known.has(bad));
        },
      ),
    );
  });

  it('never throws on any parseable expression', () => {
    const idents = ['self', 'form', 'actor', 'foo', 'value', 'area'];
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            ...idents,
            '1',
            "'a'",
            'true',
            '.stage',
            '.x',
            ' + ',
            ' && ',
            ' == ',
            ' in ',
            '(',
            ')',
            '[',
            ']',
          ),
          { maxLength: 8 },
        ),
        (parts) => {
          const p = parse(parts.join(''));
          if (p.ok) expect(() => check(p.ast, ENV)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('check: history names (A-005 item 6)', () => {
  it("reports last('unknown', 3) with a hint", () => {
    const { result } = run("last('unknown', 3)");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain("unknown property 'unknown'");
    expect(result.errors[0]?.hint).toBeTruthy();
  });

  it.each(['last(self.stage, 3)', 'changed(1)', 'count(a)', 'previous(self)'])(
    'non-literal name %s is an error',
    (src) => {
      const p = parse(src);
      if (!p.ok) return;
      const result = check(p.ast, ENV);
      expect(result.ok).toBe(false);
    },
  );

  it('checks a 1,000-term chain without a stack overflow', () => {
    const src = Array.from({ length: 1000 }, () => 'true').join(' || ');
    expect(run(src).result.ok).toBe(true);
  });

  it('checks the longest chain the config limits allow without a stack overflow', () => {
    const src = 'a||'.repeat(PARSE_LIMITS.config.maxLength / 3 - 1) + 'a';
    const p = parse(src);
    if (!p.ok) throw new Error('parse');
    expect(() => check(p.ast, { ...ENV, vars: { a: T.bool } })).not.toThrow();
  });
});
