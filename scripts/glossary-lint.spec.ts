import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkText, scanRepo, toWords } from './glossary-lint.mjs';
import { specEnv } from './testing/spec-env.mjs';

const hits = (text: string, file = 'x.ts'): string[] => checkText(text, file);

describe('glossary lint identifiers (R7)', () => {
  it.each([
    ['const ToolConfigSchema = z.object({});', 'tool config'],
    ['const field_values = [];', 'field value'],
    ['const workflowInstance = load();', 'workflow instance'],
    ['type MarkerCategory = string;', 'marker categor'],
    ['const x = "fieldDef-list";', 'field def'],
    ['// v3 had a submission queue', 'submission'],
  ])('flags %s', (text, term) => {
    const problems = hits(text);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain(term);
  });

  it.each([
    'const ToolSettingsSchema = 1;',
    'const markerless = true; // style',
    'const showcase = 1; const bookcase = 2;',
    'const fieldKey = 1; const valueOf = 2;',
  ])('accepts %s', (text) => {
    expect(hits(text)).toEqual([]);
  });

  it('prints file:line and the glossary replacement', () => {
    const problems = hits('ok\nconst ToolConfigSchema = 1;', 'packages/a/b.ts');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^packages\/a\/b\.ts:2 /);
    expect(problems[0]).toContain('use view / tool / field');
  });

  it('splits camel, Pascal, snake and kebab identifiers', () => {
    expect(toWords('HTMLParserFoo')).toBe('html parser foo');
    expect(toWords('a_b-c d')).toBe('a b c d');
  });

  it('honours allowlist entries only for their file, and each has a reason', () => {
    const cfg = JSON.parse(readFileSync(new URL('./glossary-terms.json', import.meta.url), 'utf8'));
    for (const a of cfg.allow) {
      expect(a.reason).toBeTruthy();
      expect(hits(`// ${a.words}s`, a.file)).toEqual([]);
      expect(hits(`// ${a.words}s`, 'other.ts')).toHaveLength(1);
    }
  });

  // Work is measured, not wall time: a wall-clock assert flaked under machine load (load average ~38).
  it('scans every file once and reads each byte once', () => {
    const t = Date.now();
    const { files, reads, bytes, problems } = scanRepo();
    const ms = Date.now() - t;
    expect(files.length).toBeGreaterThan(100);
    expect(reads).toEqual(files);
    expect(new Set(reads).size).toBe(reads.length);
    expect(bytes).toBeGreaterThan(0);
    expect(problems).toEqual([]);
    console.info(`glossary-lint: ${files.length} files, ${bytes} bytes, ${ms} ms (not asserted)`);
  });

  it('exits 0 on the repo', () => {
    expect(() =>
      execFileSync('node', ['scripts/glossary-lint.mjs'], { timeout: 60_000, env: specEnv() }),
    ).not.toThrow();
  });
});
