import { describe, expect, it } from 'vitest';
import committed from '../../../../schema/ueberblick-1.schema.json?raw';
import { RoleSchema } from './index';
import { projectFileJsonSchema } from './json-schema';

describe('RoleSchema.description (E-4)', () => {
  it('parses a role with a plain or a localized description', () => {
    expect(RoleSchema.safeParse({ label: 'Gutachter', description: 'Prüft Meldungen' }).success).toBe(true);
    expect(
      RoleSchema.safeParse({ label: 'Gutachter', description: { de: 'Prüft', en: 'Reviews' } }).success,
    ).toBe(true);
  });
  it('parses a role without one', () => {
    expect(RoleSchema.safeParse({ label: 'Gutachter' }).success).toBe(true);
  });
  it('refuses an empty description', () => {
    expect(RoleSchema.safeParse({ label: 'Gutachter', description: '' }).success).toBe(false);
  });
  it('is in the JSON schema, and the committed schema file carries it', () => {
    expect(JSON.stringify(projectFileJsonSchema())).toContain('What the role is for');
    expect(committed).toContain('What the role is for');
  });
});
