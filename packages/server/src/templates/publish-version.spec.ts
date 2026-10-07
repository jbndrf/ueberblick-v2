import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { TemplateFile } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { openControlDb } from '../db/open';
import { publishTemplateVersion, type TemplateCatalog } from './publish-version';

const golden = resolve(import.meta.dirname, '../../../../fixtures/golden');
const read = (rel: string): string => embedGoldenSource(readFileSync(resolve(golden, rel), 'utf8'));
const templates: TemplateFile[] = readdirSync(resolve(golden, 'templates/baumkataster'))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => parse(read(`templates/baumkataster/${f}`)) as TemplateFile);
const catalog: TemplateCatalog = { versionsOf: (key) => templates.filter((t) => t.template.key === key) };
const v = (n: string): TemplateFile => templates.find((t) => t.template.version === n) as TemplateFile;
const clock = { now: () => '2026-10-02T08:00:00Z' };

describe('publishTemplateVersion', () => {
  const yaml = (file: unknown): string => JSON.stringify(file);

  it('refuses the golden 1.2.0 candidate (breaking in a minor) and publishes a clean minor', () => {
    const control = openControlDb(':memory:');
    const bad = read('candidates/baumkataster/1.2.0.yaml');
    const r = publishTemplateVersion(control, catalog, clock, bad);
    expect(r).toMatchObject({ ok: false, reason: 'refused', codes: ['breaking_in_minor'] });
    const clean = { ...v('1.1.0'), template: { ...v('1.1.0').template, version: '1.2.0' } };
    expect(publishTemplateVersion(control, catalog, clock, yaml(clean))).toEqual({ ok: true, created: true });
    expect(publishTemplateVersion(control, catalog, clock, yaml(clean))).toEqual({
      ok: true,
      created: false,
    });
  });

  it('reports an invalid file', () => {
    const control = openControlDb(':memory:');
    expect(publishTemplateVersion(control, catalog, clock, 'schema: 3')).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });
});
