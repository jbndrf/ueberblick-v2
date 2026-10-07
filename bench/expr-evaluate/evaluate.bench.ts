/**
 * Budget (WP-021, WP-127, A-012): a full re-evaluation of a `when` on 60k features, in a worker after a config
 * change, <= 100 ms after the x4 device factor; with one relation hop and a text function <= 150 ms. The
 * expression is parsed and checked once; each feature gets its own context, as every plan call site builds one.
 * Run: npm test -- -c bench/vitest.config.ts bench/expr-evaluate
 */
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import type { FeatureAccess, EvalContext, EvalValue } from '../../packages/core/src/expr/contract';
import type { Env } from '../../packages/core/src/expr/check';
import type * as Core from './entry';
import type { FeatureId, Key } from '../../packages/core/src/model';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';

// The core is bundled first and run as plain node code, like the app ships it. Under vitest every call
// across modules goes through a getter of the module object, which measures the test runner, not the core.
const out = join(mkdtempSync(join(tmpdir(), 'expr-evaluate-')), 'core.cjs');
buildSync({
  entryPoints: [join(import.meta.dirname, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: out,
  logLevel: 'error',
});
const { check, T, createGeo, condition, parse } = createRequire(import.meta.url)(out) as typeof Core;

const N = 60_000;
const key = (s: string) => s as Key;
const ids = Array.from({ length: N }, (_, i) => `f${i}` as FeatureId);
const STAGES = ['neu', 'aktiv', 'erledigt', 'gesperrt'];

// The current state of a feature is one object, as in a device store: its properties and its relation. Every
// state has the same shape; a relation is a key without a value, which the port reports as undefined.
interface State {
  stage: string;
  hoehe: number;
  art: string;
  nachbar: undefined;
  readonly next: readonly FeatureId[];
}
const states = new Map<FeatureId, State>(
  ids.map((id, i) => [
    id,
    {
      stage: STAGES[i % 4] as string,
      hoehe: (i % 300) / 10,
      art: `art${i % 40}`,
      nachbar: undefined,
      next: [ids[(i + 1) % N] as FeatureId],
    },
  ]),
);

const stateOf = (id: FeatureId): State | undefined => states.get(id);
const features: FeatureAccess = {
  property: (id, k) => stateOf(id)?.[k as 'stage' | 'hoehe' | 'art' | 'nachbar'],
  related: (id) => stateOf(id)?.next ?? [],
  history: () => [],
  type: () => key('baum'),
};

const env: Env = {
  vars: {
    self: { kind: 'feature', type: 'baum' },
    actor: { kind: 'record', fields: { role: T.string, roles: { kind: 'list', element: T.string } } },
  },
  features: {
    baum: { stage: T.string, hoehe: T.double, art: T.string, nachbar: { kind: 'feature', type: 'baum' } },
  },
};

function compile(src: string) {
  const p = parse(src);
  if (!p.ok) throw new Error(src);
  const c = check(p.ast, env, { expect: T.bool });
  if (!c.ok) throw new Error(`${src}: ${c.errors[0]?.message}`);
  return c.typed;
}

const actor: EvalValue = { role: 'inspector', roles: ['inspector', 'viewer'] };
const relations = new Map([[key('baum'), new Set([key('nachbar')])]]);

function runAll(src: string): { ms: number; hits: number } {
  const typed = compile(src);
  let hits = 0;
  const t0 = performance.now();
  const geo = createGeo();
  // A context per feature, as every plan call site builds one (plan/rules.ts, plan/scope.ts).
  for (const id of ids) {
    const ctx: EvalContext = {
      vars: new Map<string, EvalValue>([
        ['self', { $feature: id }],
        ['actor', actor],
      ]),
      features,
      now: '2026-09-29T12:00:00.000Z',
      relations,
      geo,
    };
    if (condition(typed, ctx).value) hits++;
  }
  return { ms: performance.now() - t0, hits };
}

function median(src: string, runs = 7): { ms: number; hits: number } {
  for (let i = 0; i < 5; i++) runAll(src); // warm-up: JIT, compile cache
  const samples = Array.from({ length: runs }, () => runAll(src)).sort((a, b) => a.ms - b.ms);
  return samples[Math.floor(runs / 2)] as { ms: number; hits: number };
}

describe('bench: expr evaluate', () => {
  it('baseline: context only', () => {
    const { ms } = median('true');
    console.log(`bench baseline true: ${ms.toFixed(1)} ms`);
    const m2 = median("self.stage == 'aktiv'");
    console.log(`bench baseline stage: ${m2.ms.toFixed(1)} ms`);
  });

  it('a `when` on 60k features', () => {
    const { ms, hits } = median("self.stage == 'aktiv' && self.hoehe >= 10.0 && 'inspector' in actor.roles");
    console.log(`bench expr-evaluate when: median ${ms.toFixed(1)} ms for ${N} features, ${hits} hits`);
    expect(hits).toBeGreaterThan(0);
    assertBudget(
      report(
        defineBudget({
          id: 'expr-evaluate-60k',
          limit: 100,
          unit: 'ms',
          derivedFrom:
            'delta-visible-1s, A-012: a full re-evaluation of one rule over 60k features after a config change, in a worker; never per interaction',
          device: 'x4',
          thread: 'worker',
        }),
        ms,
      ),
    );
  });

  it('a `when` with a relation hop', () => {
    const { ms, hits } = median(
      "self.stage != 'erledigt' && self.nachbar.stage == 'aktiv' && self.art.startsWith('art1')",
    );
    console.log(`bench expr-evaluate relation: median ${ms.toFixed(1)} ms for ${N} features, ${hits} hits`);
    expect(hits).toBeGreaterThan(0);
    assertBudget(
      report(
        defineBudget({
          id: 'expr-evaluate-relation-60k',
          limit: 150,
          unit: 'ms',
          derivedFrom:
            'delta-visible-1s, A-012: a full re-evaluation of one rule with a relation hop over 60k features after a config change, in a worker',
          device: 'x4',
          thread: 'worker',
        }),
        ms,
      ),
    );
  });
});
