import { describe, expect, it } from 'vitest';
import { render, summarize } from './selection.mjs';

// WP-1006: which reasons make scoped runs run every test, and what it costs.
const MIN = 60_000;
const NOW = Date.parse('2026-10-03T12:00:00Z');
const at = (minAgo: number) => new Date(NOW - minAgo * MIN).toISOString();
const scoped = (minAgo: number, wallMs: number, branch: string, selection?: object) => ({
  at: at(minAgo),
  kind: 'scoped',
  branch,
  wallMs,
  ...(selection ? { selection } : {}),
});
const all = (reason: string) => ({ all: true, reason, seeds: 0 });
const rel = { all: false, reason: 'related', seeds: 3 };

const rows = [
  scoped(10, 10 * MIN, 'wp/a', all('trigger vite.config.ts -> all tests')),
  scoped(20, 20 * MIN, 'wp/b', all('trigger vite.config.ts -> all tests')),
  scoped(30, 5 * MIN, 'wp/a', all('trigger tsconfig.json -> all tests')),
  scoped(40, 1 * MIN, 'wp/c', rel),
  scoped(50, 1 * MIN, 'wp/c', rel),
  scoped(60, 4 * MIN, 'wp/d'), // recorded before WP-1006
  { at: at(15), kind: 'full', branch: 'main', wallMs: 99 * MIN },
  scoped(25 * 60, 50 * MIN, 'wp/old', all('trigger old -> all tests')), // outside 24 h
];

describe('selection summary', () => {
  const s = summarize(rows, { hours: 24, now: NOW });
  it('counts scoped runs, blanket runs and their share', () => {
    expect(s.scoped).toBe(6);
    expect(s.blanket).toBe(3);
    expect(s.blanketShare).toBeCloseTo(0.5);
  });
  it('sums agent-minutes of blanket runs against all scoped runs', () => {
    expect(s.blanketMinutes).toBeCloseTo(35);
    expect(s.scopedMinutes).toBeCloseTo(41);
  });
  it('groups by reason with count, minutes and branches; old rows are unrecorded', () => {
    const by = (name: string) => s.byReason.find((r: { reason: string }) => r.reason.includes(name));
    expect(by('vite.config')).toMatchObject({ count: 2, branches: ['wp/a', 'wp/b'] });
    expect(by('vite.config')?.minutes).toBeCloseTo(30);
    expect(s.byReason[0]?.reason).toContain('vite.config'); // most minutes first
    expect(by('unrecorded')).toMatchObject({ count: 1 });
    expect(by('related')).toMatchObject({ count: 2 });
  });
  it('the hours window narrows the rows', () => {
    expect(summarize(rows, { hours: 0.4, now: NOW }).scoped).toBe(2);
  });
  it('renders the table and tolerates no rows', () => {
    expect(render(s, 24)).toContain('trigger vite.config.ts -> all tests');
    expect(render(summarize([], { hours: 1, now: NOW }), 1)).toContain('0 scoped runs');
  });
});
