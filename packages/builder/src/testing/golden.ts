/** Test helper (never exported from the package): the golden projects as template + overlay sources. */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { openProject, type Doc, type Op } from '../doc';

const root = (rel: string): string => resolve(import.meta.dirname, '../../../../fixtures/golden', rel);

function templateFor(overlaySrc: string): string {
  const ext = (parse(overlaySrc) as { extends: string }).extends;
  const [key, major] = ext.split('@') as [string, string];
  const files = readdirSync(root(`templates/${key}`))
    .filter((f) => f.startsWith(`${major}.`))
    .sort();
  // A stored file is self-contained (B-013): embed the `$ref` styles as ingestion does.
  return embedGoldenSource(readFileSync(root(`templates/${key}/${files[files.length - 1]}`), 'utf8'));
}

export interface GoldenProject {
  readonly name: string;
  readonly templateSrc: string;
  readonly overlaySrc: string;
}

export const goldenProjects: readonly GoldenProject[] = readdirSync(root('projects'))
  .filter((f) => f.endsWith('.yaml'))
  .map((name) => {
    const overlaySrc = embedGoldenSource(readFileSync(root(`projects/${name}`), 'utf8'));
    return { name, overlaySrc, templateSrc: templateFor(overlaySrc) };
  });

export const musterstadt: GoldenProject = (() => {
  const p = goldenProjects.find((q) => q.name === 'musterstadt-baeume.yaml');
  if (!p) throw new Error('golden project musterstadt-baeume is missing');
  return p;
})();

/** The largest golden project by source size. */
export const largest: GoldenProject = [...goldenProjects].sort(
  (a, b) => b.templateSrc.length + b.overlaySrc.length - (a.templateSrc.length + a.overlaySrc.length),
)[0] as GoldenProject;

/** Ops that break the file in known ways, for problem tests. */
export const breakingOps: readonly Op[] = [
  { kind: 'set', path: 'types.baum.properties.art.to', value: 'gibt_es_nicht' },
];

/** musterstadt with a dangling reference: at least one problem at a `types.baum...` path. */
export function docWithProblems(): Doc {
  let doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
  for (const op of breakingOps) doc = doc.apply(op).doc;
  return doc;
}
