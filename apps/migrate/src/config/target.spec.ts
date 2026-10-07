/** The mapping of the full conversion equals that of the import conversion: the dry run and `import` use both. */
import { describe, expect, it } from 'vitest';
import { convertConfig } from './convert';
import { loadFixture } from './testing';

describe.each(['baumkontrolle', 'meldungen', 'minimal'])('%s', (name) => {
  it('has the same mapping and report with and without target: import', () => {
    const full = convertConfig(loadFixture(name));
    const imp = convertConfig(loadFixture(name), { target: 'import' });
    expect(imp.mapping).toEqual(full.mapping);
    expect(imp.report.items).toEqual(full.report.items);
    expect(imp.target).toBeDefined();
  });
});
