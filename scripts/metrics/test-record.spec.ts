import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { silentRed } from './test-record.mjs';

// WP-967: the tests.jsonl row carries the run's weight so the metrics can tell the land train's checks apart.
const src = readFileSync(new URL('./test-record.mjs', import.meta.url), 'utf8');

it('the tests.jsonl row records the weight of the run', () => {
  expect(src).toMatch(/weight:\s*slot\.weight/);
});

// WP-1006: a scoped row says why it ran what it ran; recordedSelection never throws on a missing plan.
it('the tests.jsonl row of a scoped run records the selection and its reason', () => {
  expect(src).toMatch(/selection:\s*kind === 'scoped' \? recordedSelection\(plan\)/);
});

// WP-1013: a run that exits non-zero with zero failed tests records why.
describe('silentRed', () => {
  const suiteReport = {
    numFailedTests: 0,
    testResults: [
      { name: 'a.spec.ts', status: 'passed', assertionResults: [{}] },
      {
        name: `${process.cwd()}/b.spec.ts`,
        status: 'failed',
        message: 'Error: boom\nat x',
        assertionResults: [],
      },
    ],
  };
  it('a suite that fails to load names the file and message', () => {
    expect(silentRed({ code: 1, report: suiteReport })).toEqual({
      kind: 'suite',
      file: 'b.spec.ts',
      message: 'Error: boom\nat x',
    });
  });
  it('an unhandled error is read from the report, else from stderr', () => {
    const ok = { numFailedTests: 0, testResults: [] };
    expect(silentRed({ code: 1, report: { ...ok, unhandledErrors: [{ message: 'late' }] } })).toEqual({
      kind: 'unhandled',
      message: 'late',
    });
    const r = silentRed({ code: 1, report: ok, stderr: 'x\nUnhandled Rejection: nope\nat y' });
    expect(r).toEqual({ kind: 'unhandled', message: 'Unhandled Rejection: nope\nat y' });
  });
  it('a normal red or a green run has no silentRed', () => {
    expect(silentRed({ code: 1, report: { numFailedTests: 2, testResults: [] } })).toBeUndefined();
    expect(silentRed({ code: 0, report: suiteReport })).toBeUndefined();
  });
  it('nothing to parse gives the stderr tail, capped at 2 kB', () => {
    const stderr = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(80)}`).join('\n');
    const r = silentRed({ code: 1, report: null, stderr });
    expect(r?.kind).toBe('unknown');
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(2000);
    expect(JSON.stringify(r)).toContain('line 99');
  });
});
