import { createRequire } from 'node:module';
import type { Locator, Page } from '@playwright/test';

const AXE_SOURCE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export interface Finding {
  readonly rule: string;
  readonly impact: string;
  readonly help: string;
  readonly targets: readonly string[];
}

/**
 * Accessibility failures already found, keyed by axe rule id, each with the follow-up work package that fixes it.
 * A page passes when its findings are a subset of its ledger: a new failure fails the test. A fixed failure must
 * leave the ledger (the "ledger is current" test). Every entry is listed in docs/process/bitv-self-check.md.
 */
export type Ledger = Readonly<Record<string, string>>;

/** One axe violation (the part the specs read). */
export interface Violation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: readonly { readonly target: readonly string[] }[];
}

export interface AxeOptions {
  /** A CSS selector or a locator; default is the whole document. */
  readonly scope?: string | Locator;
  /** axe `runOnly` tags; default is every rule axe runs by default. */
  readonly tags?: readonly string[];
  /** axe `rules` overrides, for example `{ 'color-contrast': { enabled: false } }`. */
  readonly rules?: Readonly<Record<string, { enabled: boolean }>>;
  /** Longest wait for animations to finish before scanning anyway, in ms (default 2000). */
  readonly settleMs?: number;
}

export interface AxeRun {
  readonly violations: readonly Violation[];
  /** False when animations were still running after `settleMs`: the scan ran mid-animation (contrast may be off). */
  readonly settled: boolean;
}

interface AxeGlobal {
  axe?: { run: (c: unknown, o: object) => Promise<{ violations: Violation[] }> };
}

/** Injects axe-core once per page (a navigation drops it, so it is checked on every call). */
async function inject(page: Page): Promise<void> {
  const has = await page.evaluate(() => (globalThis as unknown as AxeGlobal).axe !== undefined);
  if (!has) await page.addScriptTag({ path: AXE_SOURCE });
}

/**
 * Waits until every finite animation and transition has finished (a dialog fades in over 200 ms and axe reads its
 * colours mid-fade). Returns false when `ms` ran out first. Infinite animations never end and are ignored.
 */
export async function settleAnimations(page: Page, ms = 2000): Promise<boolean> {
  return page.evaluate(async (limit) => {
    const pending = (): Animation[] =>
      document.getAnimations().filter((a) => {
        const t = a.effect?.getComputedTiming().endTime;
        return a.playState !== 'finished' && a.playState !== 'idle' && t !== Infinity;
      });
    const end = performance.now() + limit;
    for (let list = pending(); list.length > 0; list = pending()) {
      const left = end - performance.now();
      if (left <= 0) return false;
      await Promise.race([
        Promise.allSettled(list.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, left)),
      ]);
    }
    return true;
  }, ms);
}

/** The one axe entry point of every e2e spec: injects axe once, waits for animations, scans the scope. */
export async function runAxe(page: Page, opts: AxeOptions = {}): Promise<AxeRun> {
  await inject(page);
  const settled = await settleAnimations(page, opts.settleMs);
  const config: Record<string, unknown> = {};
  if (opts.tags) config['runOnly'] = [...opts.tags];
  if (opts.rules) config['rules'] = opts.rules;
  const scope = typeof opts.scope === 'object' ? await opts.scope.elementHandle() : (opts.scope ?? null);
  const violations = await page.evaluate(
    async ([sel, cfg]) => {
      const r = await (globalThis as unknown as Required<AxeGlobal>).axe.run(sel ?? document, cfg as object);
      return r.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => ({ target: n.target.map(String) })),
      }));
    },
    [scope, config] as const,
  );
  return { violations, settled };
}

/** Violations as `rule target;target` strings: empty means clean, and a failure names what broke. */
export async function axeViolations(page: Page, opts: AxeOptions = {}): Promise<string[]> {
  const { violations } = await runAxe(page, opts);
  return violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(';')}`);
}

/** Scans the whole page for WCAG 2.1 A and AA violations, colour contrast included (real layout). */
export async function scan(page: Page): Promise<Finding[]> {
  const { violations } = await runAxe(page, { tags: WCAG_TAGS });
  return violations.map((v) => ({
    rule: v.id,
    impact: v.impact ?? 'minor',
    help: v.help,
    targets: v.nodes.map((n) => n.target.join(' ')),
  }));
}

/** Findings the ledger does not cover: these fail the test. */
export const unexpected = (found: readonly Finding[], ledger: Ledger): Finding[] =>
  found.filter((f) => !(f.rule in ledger));

/** Ledger entries that no longer occur: remove them. */
export const stale = (found: readonly Finding[], ledger: Ledger): string[] =>
  Object.keys(ledger).filter((rule) => !found.some((f) => f.rule === rule));
