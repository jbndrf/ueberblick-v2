// WP-181: every published baumkataster version compiles without problems and offers `flaeche_anlegen` to the
// administration.
import { describe, expect, it } from 'vitest';
import { compile } from '../../../../packages/core/src/schema/compile';
import { TemplateFileSchema } from '../../../../packages/core/src/schema/file';
import { goldenAssets, goldenYaml } from '../../../../packages/core/src/testing';

const VERSIONS = ['1.0.0', '1.1.0', '2.0.0'];

describe.each(VERSIONS)('baumkataster %s', (version) => {
  const file = TemplateFileSchema.parse(goldenYaml(`templates/baumkataster/${version}.yaml`));

  it('compiles with no problems', () => {
    const r = compile(file, { assets: goldenAssets });
    expect(r.ok ? [] : r.problems).toEqual([]);
  });

  it('has a task that creates areas, offered to the administration', () => {
    const task = file.tasks?.['flaeche_anlegen'];
    expect(task?.creates).toBe('flaeche');
    expect(task?.who).toEqual(['verwaltung', 'admin']);
  });
});
