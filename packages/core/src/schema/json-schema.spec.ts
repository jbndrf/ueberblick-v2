import { describe, expect, it } from 'vitest';
import committed from '../../../../schema/ueberblick-1.schema.json?raw';
import { projectFileJsonSchema, serializeJsonSchema } from './json-schema';

describe('JSON Schema export', () => {
  it('the committed schema/ueberblick-1.schema.json is current (run npm run gen:schema)', () => {
    expect(committed).toBe(serializeJsonSchema());
  });
  it('is deterministic', () => {
    expect(serializeJsonSchema()).toBe(serializeJsonSchema());
  });
  it('carries the descriptions', () => {
    const text = JSON.stringify(projectFileJsonSchema());
    expect(text).toContain('The property type, from the property type registry.');
    expect(text).toContain('maplibre-2d');
  });
  it('every property of the template has a description', () => {
    const missing: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const n = node as Record<string, unknown>;
      const props = n['properties'];
      if (props && typeof props === 'object') {
        for (const [k, v] of Object.entries(props)) {
          const has = typeof v === 'object' && v !== null && 'description' in v;
          if (!has) missing.push(`${path}.${k}`);
          walk(v, `${path}.${k}`);
        }
      }
      for (const key of ['items', 'additionalProperties', 'anyOf', 'oneOf']) {
        const c = n[key];
        if (Array.isArray(c)) c.forEach((x, i) => walk(x, `${path}.${key}${i}`));
        else walk(c, `${path}.${key}`);
      }
      for (const [k, v] of Object.entries(n['patternProperties'] ?? {})) walk(v, `${path}.${k}`);
    };
    walk(projectFileJsonSchema(), '$');
    expect(missing).toEqual([]);
  });
});
