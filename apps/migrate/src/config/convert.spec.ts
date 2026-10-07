/** WP-300 acceptance: fixtures cover every concept, converted files compile, the report is complete, output is glossary-clean. */
import { compile, NO_ASSETS, merge, parseProjectFile } from '@ueberblick/core';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { checkText } from '../../../../scripts/glossary-lint.mjs';
import { observedConcepts, V3_CONCEPTS } from './concepts';
import { convertConfig } from './convert';
import { readProject, V3ExportError } from './read';
import { NOT_HANDLED } from './report';
import { FIXTURES, loadFixture, syntheticProject } from './testing';

describe('the synthetic fixtures', () => {
  it('together cover every v3 configuration concept of the inventory (checklist)', () => {
    const seen = new Set<string>();
    for (const f of FIXTURES) for (const c of observedConcepts(loadFixture(f))) seen.add(c);
    const missing = V3_CONCEPTS.filter((c) => !seen.has(c));
    expect(missing).toEqual([]);
  });
});

describe.each(FIXTURES)('convertConfig(%s)', (name) => {
  const v3 = loadFixture(name);
  const result = convertConfig(v3);

  it('gives schema-valid files that compile with zero problems', () => {
    expect(parseProjectFile(result.template).success).toBe(true);
    expect(parseProjectFile(result.overlay).success).toBe(true);
    const merged = merge(result.template, result.overlay);
    expect(merged.issues).toEqual([]);
    const compiled = compile(merged.file, { assets: NO_ASSETS });
    expect(compiled.ok ? [] : compiled.problems).toEqual([]);
    expect(result.check.ok).toBe(true);
    expect(result.check.problems).toEqual([]);
    expect(result.check.schemaIssues).toEqual([]);
  });

  it('gives a template that compiles on its own and an overlay that extends it', () => {
    const own = compile(result.template, { assets: NO_ASSETS });
    expect(own.ok).toBe(true);
    expect(result.overlay.extends).toBe(`${result.template.template.key}@1`);
    expect(result.template.template.version).toBe('1.0.0');
  });

  it('accounts for 100% of the input items, each exactly once', () => {
    const inventory = readProject(v3).inventory;
    const ids = result.report.items.map((i) => i.id);
    expect(ids).toEqual(inventory);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.report.stray).toEqual([]);
    expect(result.report.items.filter((i) => i.reason === NOT_HANDLED).map((i) => i.id)).toEqual([]);
    const s = result.report.summary;
    expect(s.mapped + s.approximated + s.dropped).toBe(s.total);
    expect(s.total).toBe(inventory.length);
  });

  it('gives a reason for everything approximated or dropped', () => {
    const bad = result.report.items.filter((i) => i.status !== 'mapped' && i.reason.trim() === '');
    expect(bad).toEqual([]);
  });

  it('writes v4 words only (glossary lint on the output)', () => {
    expect(checkText(stringify(result.template), `${name}.template.yaml`)).toEqual([]);
    expect(checkText(stringify(result.overlay), `${name}.overlay.yaml`)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(convertConfig(loadFixture(name))).toEqual(result);
  });
});

describe('input validation', () => {
  it('refuses a root that is not a v3 export', () => {
    expect(() => convertConfig(null)).toThrow(V3ExportError);
    expect(() => convertConfig({ format: 2, workflows: [] })).toThrow(V3ExportError);
    expect(() => convertConfig({ format: 1 })).toThrow(V3ExportError);
  });

  it('accounts for parts it does not know as dropped, with a reason', () => {
    const v3 = loadFixture('minimal') as Record<string, unknown>;
    const wf = (v3['workflows'] as Record<string, unknown>[])[0] as Record<string, unknown>;
    (wf['record'] as Record<string, unknown>)['sparkle'] = true;
    (v3['settings'] as Record<string, unknown>)['theme'] = 'dark';
    const r = convertConfig(v3);
    const item = (id: string) => r.report.items.find((i) => i.id === id);
    expect(item('workflows.punkt.sparkle')?.status).toBe('dropped');
    expect(item('workflows.punkt.sparkle')?.reason).toMatch(/unknown v3 column/);
    expect(item('settings.theme')?.status).toBe('dropped');
    expect(r.report.stray).toEqual([]);
  });
});

describe('performance (R14)', () => {
  it('converts the largest synthetic project cleanly', () => {
    const big = syntheticProject(40, 30);
    const r = convertConfig(big);
    console.log(`WP-300 convert: 40 feature types x 30 fields, ${r.report.summary.total} items`);
    expect(r.check.problems).toEqual([]);
    expect(r.check.ok).toBe(true);
  });
});
