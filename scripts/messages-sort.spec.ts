import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogueDirs, isSorted, messageFiles, sortMessages } from './messages-sort.mjs';

const unsorted = '{\n  "$schema": "s",\n  "b_x": "1",\n  "a_y": "2",\n  "b_a": "3"\n}\n';

describe('messages:sort', () => {
  it('detects an unsorted file and fixes it, $schema first', () => {
    expect(isSorted(unsorted)).toBe(false);
    const fixed = sortMessages(unsorted);
    expect(Object.keys(JSON.parse(fixed))).toEqual(['$schema', 'a_y', 'b_a', 'b_x']);
    expect(isSorted(fixed)).toBe(true);
    expect(sortMessages(fixed)).toBe(fixed);
  });

  it('keeps $schema first even when it sorts later', () => {
    expect(Object.keys(JSON.parse(sortMessages('{"a":"1","$schema":"s"}')))).toEqual(['$schema', 'a']);
  });

  it('every repo messages file is sorted', () => {
    const files = messageFiles();
    expect(files.length).toBeGreaterThanOrEqual(14); // ui, builder, four tools, apps/web: de and en each
    expect(catalogueDirs().some((d) => d.includes('tools'))).toBe(true);
    expect(catalogueDirs().some((d) => d.startsWith('apps'))).toBe(true);
    for (const f of files) expect(isSorted(readFileSync(f, 'utf8')), f).toBe(true);
  });
});
