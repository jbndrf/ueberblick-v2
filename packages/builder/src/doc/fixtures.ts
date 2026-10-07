import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  compile,
  merge,
  NO_ASSETS,
  problemsFromMergeIssues,
  TemplateFileSchema,
  type Problem,
} from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { openProject, type Doc, type Op } from './index';

export const golden = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../fixtures/golden/${rel}`, import.meta.url)), 'utf8');

/** Latest template source for an `extends: key@major`. */
function templateFor(overlaySrc: string): string {
  const ext = (parse(overlaySrc) as { extends: string }).extends;
  const [key, major] = ext.split('@') as [string, string];
  const files = readdirSync(
    fileURLToPath(new URL(`../../../../fixtures/golden/templates/${key}`, import.meta.url)),
  )
    .filter((f) => f.startsWith(`${major}.`))
    .sort();
  // A stored template is self-contained (B-013): embed the `$ref` styles as ingestion does.
  return embedGoldenSource(golden(`templates/${key}/${files[files.length - 1]}`));
}

export const projects = readdirSync(
  fileURLToPath(new URL('../../../../fixtures/golden/projects', import.meta.url)),
)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => ({ name: f, overlaySrc: embedGoldenSource(golden(`projects/${f}`)) }))
  .map((p) => ({ ...p, templateSrc: templateFor(p.overlaySrc) }));

export const project = (name: string) => {
  const p = projects.find((q) => q.name === name);
  if (!p) throw new Error(name);
  return p;
};
export const musterstadt = project('musterstadt-baeume.yaml');
export const open = (p = musterstadt): Doc => openProject(p.templateSrc, p.overlaySrc);
export const set = (path: string, value: unknown): Op => ({ kind: 'set', path, value });

/** What a fresh, independent computation says the problems are. */
export function freshProblems(templateSrc: string, overlaySrc: string): readonly Problem[] {
  const tpl = TemplateFileSchema.parse(parse(templateSrc));
  const m = merge(tpl, parse(overlaySrc));
  const c = compile(m.file, { assets: NO_ASSETS });
  return [...problemsFromMergeIssues(m.issues), ...(c.ok ? c.warnings : c.problems)];
}
