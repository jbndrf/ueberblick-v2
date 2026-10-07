// WP-507: every input of every golden template explains itself in German and English.
import { describe, expect, it } from 'vitest';
import { TemplateFileSchema } from '../../../../packages/core/src/schema/file';
import { goldenYaml } from '../../../../packages/core/src/testing';

const TEMPLATES = [
  'baumkataster/1.0.0',
  'baumkataster/1.1.0',
  'baumkataster/2.0.0',
  'maengelmelder/1.0.0',
  'veranstaltung/1.0.0',
];

describe.each(TEMPLATES)('template %s inputs', (path) => {
  const file = TemplateFileSchema.parse(goldenYaml(`templates/${path}.yaml`));
  const inputs = Object.entries(file.inputs ?? {});

  it('has inputs', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  it.each(inputs)('input %s has a de and en description', (_key, input) => {
    const d = input.description;
    expect(typeof d).toBe('object');
    const loc = d as Record<string, string>;
    expect(loc['de']?.length).toBeGreaterThan(20);
    expect(loc['en']?.length).toBeGreaterThan(20);
  });
});
