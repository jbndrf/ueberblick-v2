// Every key of the registries behind the relation options has a label and a help line (R1: one module for both views).
// Lives under the admin route because it imports the builder registries (builder boundary).
import { describe, expect, it } from 'vitest';
import { RELATION_CARDINALITIES } from '@ueberblick/core';
import { ON_DELETE_BEHAVIORS, RELATION_ATTACHMENTS, RELATION_GEOMETRIES } from '@ueberblick/builder';
import {
  ATTACHMENT,
  ATTACHMENT_HELP,
  GEOMETRY,
  GEOMETRY_HELP,
  MULTIPLICITY,
  ON_DELETE,
  ON_DELETE_HELP,
  relationLabel,
} from '../../../../../../lib/admin/relations/labels';

const cases = [
  ['multiplicity', RELATION_CARDINALITIES, MULTIPLICITY],
  ['attachment', RELATION_ATTACHMENTS, ATTACHMENT],
  ['attachment help', RELATION_ATTACHMENTS, ATTACHMENT_HELP],
  ['on delete', ON_DELETE_BEHAVIORS, ON_DELETE],
  ['on delete help', ON_DELETE_BEHAVIORS, ON_DELETE_HELP],
  ['geometry', RELATION_GEOMETRIES, GEOMETRY],
  ['geometry help', RELATION_GEOMETRIES, GEOMETRY_HELP],
] as const;

describe('relation labels registry coverage', () => {
  for (const [name, registry, map] of cases) {
    it(`${name}: every registry key has a message, and no extra key`, () => {
      const keys = registry.keys as readonly string[];
      expect(Object.keys(map).sort()).toEqual([...keys].sort());
      for (const key of keys) expect(relationLabel('de', map, key)).not.toBe(key);
    });
  }
});
