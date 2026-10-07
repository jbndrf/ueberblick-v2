import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parityRow } from './parity-rows.mjs';

// WP-1015: the report has one parity row, read through parity.mjs.
describe('parityRow', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parity-row-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const el = (id: string, status: string, evidence = 'WP-1') => ({
    id,
    step: 2,
    register: 'r',
    label: id,
    status,
    evidence,
    checked: '2026-10-03',
  });
  it('shows total % done and % verified of the fixture elements file', () => {
    const file = join(dir, 'elements.json');
    writeFileSync(
      file,
      JSON.stringify([
        el('a', 'verified', 'x.spec.ts:1'),
        el('b', 'built'),
        el('c', 'missing'),
        el('d', 'missing'),
        el('e', 'dropped'),
      ]),
    );
    const row = parityRow(file);
    expect(row?.[0]).toBe('parity (v3 elements)');
    expect(row?.[1]).toContain('50.0 % done, 25.0 % verified (2 of 4 elements, 1 dropped)');
  });
  it('is absent without an elements file', () => {
    expect(parityRow(join(dir, 'none.json'))).toBeNull();
  });
});
