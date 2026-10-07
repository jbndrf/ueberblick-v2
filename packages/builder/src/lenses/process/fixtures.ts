/** Test helper (never exported): golden templates as documents without overlay edits. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { openProject, type Doc } from '../../doc';

export const templates = [
  ['baumkataster', '2.0.0'],
  ['baumkataster', '1.1.0'],
  ['maengelmelder', '1.0.0'],
  ['veranstaltung', '1.0.0'],
] as const;

/** The value, or a failing test when there is none. */
export function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value');
  return v;
}

/** `embed: false` keeps the `$ref` layer styles, for the views lens specs that test how the builder shows them. */
export function goldenDoc(key: string, version: string, embed = true): Doc {
  const src = readFileSync(
    resolve(import.meta.dirname, `../../../../../fixtures/golden/templates/${key}/${version}.yaml`),
    'utf8',
  );
  return openProject(
    embed ? embedGoldenSource(src) : src,
    `schema: ueberblick/1\nextends: ${key}@${version.split('.')[0]}\n`,
  );
}
