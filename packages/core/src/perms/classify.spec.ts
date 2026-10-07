import { describe, expect, it } from 'vitest';
import type { CompiledConfig } from '../schema/compile/contract';
import { classifiedFor } from './classify';
import { actor, world } from './__fixtures__/world';

const base = world();
const withClassify = (property: string): CompiledConfig => {
  const baum = base.file.types?.baum;
  if (baum === undefined) throw new Error('no baum');
  const classify = { property, values: { a: { color: '#f00' } } };
  return { ...base, file: { ...base.file, types: { ...base.file.types, baum: { ...baum, classify } } } };
};

describe('classifiedFor (WP-1075)', () => {
  const config = withClassify('intern_notiz'); // readable by kontrolle only

  it('keeps the classify for a role that may read the property', () => {
    expect(classifiedFor(config, actor(['kontrolle'])).file.types?.baum?.classify?.property).toBe(
      'intern_notiz',
    );
  });

  it('drops it for a role that may not, and leaves the rest of the type', () => {
    const out = classifiedFor(config, actor(['bauhof']));
    expect(out.file.types?.baum?.classify).toBeUndefined();
    expect(out.file.types?.baum?.properties).toBe(config.file.types?.baum?.properties);
    expect(classifiedFor(config, actor(['bauhof']))).toBe(out);
  });

  it('is the same config when no type classifies', () => {
    expect(classifiedFor(base, actor(['bauhof']))).toBe(base);
  });
});
