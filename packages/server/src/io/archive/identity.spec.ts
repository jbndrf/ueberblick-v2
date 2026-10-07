import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { TemplateFile } from '@ueberblick/core';
import { golden } from '../../store/run/testkit';
import { withOwnIdentity } from './identity';

const file = golden('musterstadt-plain').file;
const text = stringify(file);
const key = (t: string): string => (parse(t) as TemplateFile).template.key;

describe('withOwnIdentity (WP-384)', () => {
  it('keeps a file whose template is unknown here (it is published as it is)', () => {
    expect(withOwnIdentity({ resolve: () => undefined }, text)).toBe(text);
  });

  it('keeps a file identical to the published template version', () => {
    expect(withOwnIdentity({ resolve: () => file }, text)).toBe(text);
  });

  it('gives a file that differs from the published version its own key, the same one every time', () => {
    const published: TemplateFile = { ...file, template: { ...file.template, version: '9.9.9' } };
    const a = withOwnIdentity({ resolve: () => published }, text);
    const b = withOwnIdentity({ resolve: () => published }, text);
    expect(key(a)).toMatch(/^import_[0-9a-f]{10}$/);
    expect(key(a)).toBe(key(b));
    expect((parse(a) as TemplateFile).template.version).toBe('1.0.0');
    expect({ ...(parse(a) as TemplateFile), template: file.template }).toEqual(file);
  });
});
