import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FILE_FAULTS } from '../registry';
import { PropertySchema } from '../schema/property';
import type { Json } from '../model';
import type { Property } from '../schema/property';
import { fileFault, typeFits } from './type';

const prop = (extra: Record<string, unknown> = {}): Property =>
  PropertySchema.parse({ type: 'file', ...extra });
const ref = (name: string, mime: string, sha256 = 'ab12'): Json => ({ sha256, name, mime });

describe('file property value', () => {
  it('accepts a list up to max_files and refuses one more with a registry fault', () => {
    const p = prop({ max_files: 2 });
    expect(typeFits(p, [ref('a.jpg', 'image/jpeg')])).toBe(true);
    expect(typeFits(p, [ref('a.jpg', 'image/jpeg'), ref('b.jpg', 'image/jpeg')])).toBe(true);
    const three = [ref('a.jpg', 'image/jpeg'), ref('b.jpg', 'image/jpeg'), ref('c.jpg', 'image/jpeg')];
    expect(typeFits(p, three)).toBe(false);
    expect(fileFault(p, three)).toBe('too_many_files');
    expect(FILE_FAULTS.has('too_many_files')).toBe(true);
  });

  it('defaults max_files to 10', () => {
    const p = prop();
    const n = (k: number): Json =>
      Array.from({ length: k }, (_, i) => ref(`f${String(i)}.pdf`, 'application/pdf', `h${String(i)}`));
    expect(typeFits(p, n(10))).toBe(true);
    expect(typeFits(p, n(11))).toBe(false);
  });

  it('refuses a single object and malformed entries', () => {
    const p = prop();
    expect(fileFault(p, ref('a.jpg', 'image/jpeg'))).toBe('malformed_file');
    expect(fileFault(p, ['x'])).toBe('malformed_file');
    expect(fileFault(p, [{ sha256: 'a', name: 'a' }])).toBe('malformed_file');
    expect(fileFault(p, [{ sha256: '', name: 'a', mime: 'a/b' }])).toBe('malformed_file');
  });

  it('matches accept by wildcard, exact MIME and extension', () => {
    const p = prop({ accept: ['image/*', 'application/pdf', '.dwg'] });
    expect(typeFits(p, [ref('a.png', 'image/png')])).toBe(true);
    expect(typeFits(p, [ref('a.pdf', 'application/pdf')])).toBe(true);
    expect(typeFits(p, [ref('plan.DWG', 'application/octet-stream')])).toBe(true);
    expect(typeFits(p, [ref('a.txt', 'text/plain')])).toBe(false);
    expect(fileFault(p, [ref('a.txt', 'text/plain')])).toBe('file_not_accepted');
    expect(typeFits(prop(), [ref('a.txt', 'text/plain')])).toBe(true);
  });

  it('validates the options in the schema', () => {
    expect(PropertySchema.safeParse({ type: 'file', max_files: 0 }).success).toBe(false);
    expect(PropertySchema.safeParse({ type: 'file', accept: 'image/*' }).success).toBe(false);
    expect(PropertySchema.safeParse({ type: 'file', accept: [] }).success).toBe(false);
    expect(PropertySchema.safeParse({ type: 'file', accept: ['pdf'] }).success).toBe(false);
    expect(
      PropertySchema.safeParse({ type: 'file', accept: ['image/*', '.pdf'], max_files: 3 }).success,
    ).toBe(true);
    expect(PropertySchema.safeParse({ type: 'text', max_files: 3 }).success).toBe(false);
  });

  it('property: any accepted value round-trips through the schema and the check', () => {
    const refArb = fc.record({
      sha256: fc.stringMatching(/^[0-9a-f]{8}$/),
      name: fc.stringMatching(/^[a-z]{1,6}\.(png|pdf|glb)$/),
      mime: fc.constantFrom('image/png', 'application/pdf', 'model/gltf-binary'),
    });
    fc.assert(
      fc.property(
        fc.array(refArb, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.option(fc.subarray(['image/*', 'application/pdf', '.glb', 'model/*'], { minLength: 1 }), {
          nil: undefined,
        }),
        (files, max, accept) => {
          const p = PropertySchema.parse(
            JSON.parse(JSON.stringify({ type: 'file', max_files: max, ...(accept && { accept }) })),
          );
          const value = JSON.parse(JSON.stringify(files)) as Json;
          const fault = fileFault(p, value);
          expect(typeFits(p, value)).toBe(fault === undefined);
          if (files.length > max) expect(fault).toBe('too_many_files');
          if (fault === undefined) expect(PropertySchema.parse(p)).toEqual(p);
        },
      ),
    );
  });
});
