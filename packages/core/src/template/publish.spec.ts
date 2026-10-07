import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { TemplateFile } from '../schema';
import { checkPublish } from './publish';

const golden = (rel: string): TemplateFile =>
  parse(
    readFileSync(resolve(import.meta.dirname, '../../../../fixtures/golden', rel), 'utf8'),
  ) as TemplateFile;
const v110 = golden('templates/baumkataster/1.1.0.yaml');
const v200 = golden('templates/baumkataster/2.0.0.yaml');
const candidate = golden('candidates/baumkataster/1.2.0.yaml');

const withVersion = (f: TemplateFile, version: string): TemplateFile => ({
  ...f,
  template: { ...f.template, version },
});

describe('checkPublish', () => {
  it('accepts a first version', () => {
    expect(checkPublish(undefined, v110)).toEqual({ ok: true });
  });

  it('accepts a minor version without breaking changes', () => {
    expect(checkPublish(v110, withVersion(v110, '1.2.0'))).toEqual({ ok: true });
  });

  it('refuses the golden 1.2.0 candidate: a select option was removed in a minor', () => {
    const r = checkPublish(v110, candidate);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reasons.map((x) => x.code)).toEqual(['breaking_in_minor']);
    expect(r.breaking.map((b) => [b.kind, b.path])).toEqual([
      ['option_removed', 'types.baum.properties.vitalitaet.options.v4'],
    ]);
  });

  it('allows the same breaking change in a major version', () => {
    expect(checkPublish(v110, v200)).toEqual({ ok: true });
  });

  it('refuses a version that is not higher, and another template key', () => {
    expect(checkPublish(v110, v110)).toMatchObject({ ok: false, reasons: [{ code: 'version_not_higher' }] });
    expect(checkPublish(v200, withVersion(v110, '1.9.0'))).toMatchObject({
      ok: false,
      reasons: [{ code: 'version_not_higher' }],
    });
    const other = { ...v110, template: { ...v110.template, key: 'anderes', version: '1.2.0' } };
    expect(checkPublish(v110, other)).toMatchObject({ ok: false, reasons: [{ code: 'key_changed' }] });
  });
});
