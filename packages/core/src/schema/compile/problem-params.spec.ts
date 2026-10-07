import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile } from './index';
import { TEMPLATE_ISSUE_CODES } from '../../registry/admin';
import { PROBLEM_VARIANTS, DANGLING_KINDS } from '../../registry/compile';
import { TemplateFileSchema, type OverlayFile, type TemplateFile } from '../file';
import { merge } from '../../template';
import { goldenAssets } from '../../testing/golden';
import { problemsFromMergeIssues } from './problems';
import type { Problem } from './contract';

const raw = import.meta.glob('./__fixtures__/*.yaml', { query: '?raw', import: 'default', eager: true });
const load = (name: string): unknown => parse(raw[`./__fixtures__/${name}.yaml`] as string);

interface Case {
  name: string;
  code: string;
  set: Record<string, unknown>;
}

function patched(c: Case): TemplateFile {
  const f = structuredClone(load('base')) as Record<string, unknown>;
  for (const [path, value] of Object.entries(c.set)) {
    const parts = path.split('.');
    let cur = f;
    for (const p of parts.slice(0, -1)) {
      cur[p] ??= {};
      cur = cur[p] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1] as string] = value;
  }
  return TemplateFileSchema.parse(f);
}

const problemsOf = (file: TemplateFile): readonly Problem[] => {
  const r = compile(file, { assets: goldenAssets });
  return r.ok ? r.warnings : r.problems;
};

describe('problem params (WP-416)', () => {
  const found = (load('cases') as Case[]).flatMap((c) => problemsOf(patched(c)));

  it('the negative fixtures produce problems', () => {
    expect(found.length).toBeGreaterThan(40);
  });

  it('every compile problem carries params: flat strings and numbers', () => {
    for (const p of found) {
      expect(p.params, `${p.code} at ${p.path}`).toBeDefined();
      for (const v of Object.values(p.params ?? {})) expect(['string', 'number']).toContain(typeof v);
    }
  });

  it('a variant is one the registry lists, and a dangling reference names a registered kind', () => {
    for (const p of found) {
      const variant = p.params?.['variant'];
      if (variant !== undefined) expect(PROBLEM_VARIANTS.has(`${p.code}.${String(variant)}`)).toBe(true);
      if (p.code === 'dangling_reference' && p.params?.['variant'] !== 'locked_path') {
        expect(DANGLING_KINDS.has(String(p.params?.['what']))).toBe(true);
      }
    }
  });

  it('a dangling reference names the value and what exists, and keeps its English message', () => {
    const p = found.find((q) => q.code === 'dangling_reference' && q.path === 'tasks.kontrolle.on');
    expect(p?.params).toMatchObject({ value: 'baeume', what: 'feature_type' });
    expect(p?.message).toBe("'baeume' is not a known feature type");
  });

  it('merge issues become problems with params and a registered variant', () => {
    const template = structuredClone(load('base')) as TemplateFile;
    const overlay = {
      override: { 'types.nix.label': 'x' },
      add: { 'types.baum.properties.art': {}, nix: {} },
      hide: ['types.nix'],
      order: { types: ['nix'] },
    } as unknown as OverlayFile;
    const issues = merge(TemplateFileSchema.parse(template), overlay).issues;
    const problems = problemsFromMergeIssues(issues);
    expect(problems.length).toBeGreaterThan(3);
    for (const p of problems) {
      expect(TEMPLATE_ISSUE_CODES.has(p.code)).toBe(true);
      expect(p.params?.['path']).toBe(p.path);
      const variant = p.params?.['variant'];
      if (variant !== undefined) expect(PROBLEM_VARIANTS.has(`${p.code}.${String(variant)}`)).toBe(true);
    }
  });
});
