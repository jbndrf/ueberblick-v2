import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProject } from '@ueberblick/builder';
import { compile, TemplateFileSchema } from '@ueberblick/core';
import { goldenAssets } from '@ueberblick/core/testing';
import { editOverlay } from './sidebar-types-client';
import { importedTypeEdit } from '../../../../lib/admin/import/geojson-type';

const GOLDEN = fileURLToPath(new URL('../../../../../../../fixtures/golden/', import.meta.url));
const template = readFileSync(`${GOLDEN}templates/baumkataster/1.0.0.yaml`, 'utf8');
const overlay = readFileSync(`${GOLDEN}projects/musterstadt-baeume.yaml`, 'utf8');

const input = {
  name: 'Hochstämme',
  geometry: 'point',
  columns: [
    { name: 'Art', type: 'text' },
    { name: 'Höhe (m)', type: 'number' },
  ],
} as const;

describe('importedTypeEdit: the draft edit of a new type from a file', () => {
  it('adds the type and its creating task to the overlay; the draft still compiles', () => {
    const effective = openProject(template, overlay).effective();
    const { ops, result } = importedTypeEdit(input)(effective);
    expect(result.typeKey).toBe('hochstaemme');
    expect(result.mapping.task).toBe('hochstaemme_import');
    const next = editOverlay(template, overlay, ops);
    expect(next).not.toBeNull();
    const file = openProject(template, next ?? '').effective();
    expect(file.types?.['hochstaemme']?.label).toBe('Hochstämme');
    expect(file.tasks?.['hochstaemme_import']).toMatchObject({ creates: 'hochstaemme', on: '$none' });
    const compiled = compile(TemplateFileSchema.parse(file), { assets: goldenAssets });
    expect(compiled.ok).toBe(true);
  });

  it('keys stay unique: a second import of the same name gets the next key', () => {
    const first = importedTypeEdit(input)(openProject(template, overlay).effective());
    const once = editOverlay(template, overlay, first.ops) ?? '';
    const second = importedTypeEdit(input)(openProject(template, once).effective());
    expect(second.result.typeKey).toBe('hochstaemme_2');
    expect(second.result.mapping.task).toBe('hochstaemme_2_import');
    expect(editOverlay(template, once, second.ops)).not.toBeNull();
  });

  it('a file without geometry becomes a type without geometry (a Tabelle) and compiles', () => {
    const { ops } = importedTypeEdit({ ...input, geometry: null })(
      openProject(template, overlay).effective(),
    );
    const next = editOverlay(template, overlay, ops) ?? '';
    const file = openProject(template, next).effective();
    expect(file.types?.['hochstaemme']).not.toHaveProperty('geometry');
    expect(compile(TemplateFileSchema.parse(file), { assets: goldenAssets }).ok).toBe(true);
  });
});
