import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import { goldenFile } from '../../../../e2e/golden';
import { loadImportSetup } from './setup.server';

const templateSrc = readFileSync(goldenFile('templates/baumkataster/1.0.0.yaml'), 'utf8');
const overlaySrc = 'schema: ueberblick/1\nextends: baumkataster@1\n';
const deployed = {
  types: { baum: { properties: { a: { type: 'text' } } } },
  tasks: { neu: { creates: 'baum', form: { a: {} } } },
} as unknown as TemplateFile;

describe('loadImportSetup: deployed file first, the draft for what was never published (A4)', () => {
  it('a deployed type is mapped on the deployed file', () => {
    const r = loadImportSetup({ deployed: () => deployed, draft: () => null }, 'baum', 'de');
    expect(r.published).toBe(true);
    expect(r.setup?.task).toBe('neu');
  });

  it('a type only in the draft is mapped on the draft, and is not published', () => {
    const r = loadImportSetup(
      { deployed: () => undefined, draft: () => ({ templateSrc, overlaySrc }) },
      'baum',
      'de',
    );
    expect(r.published).toBe(false);
    expect(r.setup?.task).toBe('erfassen');
    expect(r.setup?.stage?.property).toBe('stage');
  });

  it('nothing known: no setup; a draft that does not open: no setup', () => {
    expect(loadImportSetup({ deployed: () => undefined, draft: () => null }, 'baum', 'de').setup).toBeNull();
    expect(
      loadImportSetup(
        { deployed: () => undefined, draft: () => ({ templateSrc: 'x: [', overlaySrc }) },
        'baum',
        'de',
      ).setup,
    ).toBeNull();
  });
});
