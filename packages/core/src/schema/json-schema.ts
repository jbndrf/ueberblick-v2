import { z } from '../zod';
import { ProjectFileSchema } from './file';

/**
 * The JSON Schema of the project file, generated from the Zod schema (F7).
 * Deterministic: `npm run gen:schema` writes it; a spec fails when the file is stale.
 */
export function projectFileJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(ProjectFileSchema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  });
  return {
    ...generated,
    $id: 'https://ueberblick.app/schema/ueberblick-1.schema.json',
    title: 'Überblick project file (schema ueberblick/1)',
  };
}

export function serializeJsonSchema(): string {
  return JSON.stringify(projectFileJsonSchema(), null, 2) + '\n';
}
