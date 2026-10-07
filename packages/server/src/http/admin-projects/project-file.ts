/**
 * Project files on the Projekte page (WP-383, S3-7): the project's effective file (template and overlay resolved)
 * for "Schema exportieren" and "Als Vorlage veröffentlichen", and "Aus Datei importieren", which creates a project
 * from a file through the same path as "Projekt erstellen". Nothing is deployed: an imported project has a draft only
 * (Q17).
 */
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';
import {
  compile,
  localize,
  merge,
  NO_ASSETS,
  OverlayFileSchema,
  TemplateFileSchema,
  type LocalizedString,
  type OverlayFile,
  type TemplateFile,
} from '@ueberblick/core';
import { createProjectFromTemplate } from '../../admin/create-project';
import { createDraftStore, draftSources } from '../../builder-draft';
import type { Db } from '../../db/driver';
import { loadConfig } from '../../deploy';
import type { TemplateSource } from '../../deploy';
import {
  controlCatalog,
  controlTemplateSource,
  parseSourceText,
  publishTemplateVersion,
} from '../../templates';

export interface FileProblem {
  readonly path: string;
  readonly message: string;
}

export type EffectiveResult =
  | { readonly ok: true; readonly file: TemplateFile }
  | {
      readonly ok: false;
      readonly code: 'not_published' | 'invalid';
      readonly problems: readonly FileProblem[];
    };

const problem = (path: string, message: string): FileProblem => ({ path, message });
const say = (m: LocalizedString): string => localize(m, ['de', 'en']);
const parseText = (text: string): { ok: true; value: unknown } | { ok: false; problems: FileProblem[] } => {
  const read = parseSourceText(text);
  return read.ok ? read : { ok: false, problems: [problem('', read.message)] };
};

/** The overlay applied to its template: merge problems and compile problems of the result. */
function resolve(base: TemplateFile, overlay: OverlayFile): EffectiveResult {
  const merged = merge(base, overlay);
  if (merged.issues.length > 0)
    return { ok: false, code: 'invalid', problems: merged.issues.map((i) => problem(i.path, i.message)) };
  const shape = TemplateFileSchema.safeParse(merged.file);
  if (!shape.success)
    return {
      ok: false,
      code: 'invalid',
      problems: shape.error.issues.map((i) => problem(i.path.join('.'), i.message)),
    };
  const compiled = compile(shape.data, { assets: NO_ASSETS });
  if (!compiled.ok)
    return {
      ok: false,
      code: 'invalid',
      problems: compiled.problems.map((p) => problem(p.path, say(p.message))),
    };
  return { ok: true, file: merged.file };
}

/** The working draft as one template file: what "Schema exportieren" downloads. */
export function effectiveDraftFile(db: Db, templates: TemplateSource): EffectiveResult {
  const draft = createDraftStore(db).get();
  if (draft === undefined) return effectiveDeployedFile(db);
  const sources = draftSources(draft, templates);
  if (sources === undefined)
    return { ok: false, code: 'invalid', problems: [problem('extends', 'The template is not available.')] };
  const overlayText = parseText(draft.overlay);
  if (!overlayText.ok) return { ok: false, code: 'invalid', problems: overlayText.problems };
  const overlay = OverlayFileSchema.safeParse(overlayText.value);
  if (!overlay.success)
    return {
      ok: false,
      code: 'invalid',
      problems: overlay.error.issues.map((i) => problem(i.path.join('.'), i.message)),
    };
  return resolve(TemplateFileSchema.parse(parse(sources.templateSrc)), overlay.data);
}

/** The deployed version as one template file: what "Als Vorlage veröffentlichen" publishes. */
export function effectiveDeployedFile(db: Db): EffectiveResult {
  const config = loadConfig(db);
  if (config === undefined)
    return {
      ok: false,
      code: 'not_published',
      problems: [problem('', 'The project has no deployed version yet.')],
    };
  return { ok: true, file: config.file };
}

/** The deployed file as a template version: the project's own template identity is replaced. */
export function templateFromProject(
  file: TemplateFile,
  identity: { readonly key: string; readonly version: string; readonly label?: LocalizedString },
): TemplateFile {
  const { label, ...rest } = identity;
  return { ...file, template: label === undefined ? rest : { ...rest, label } };
}

export interface ProjectFileImportDeps {
  readonly control: Db;
  readonly openProjectDb: (key: string) => Db;
  readonly clock: { now(): string };
}

export type ProjectFileImportOutcome =
  | { readonly ok: true; readonly key: string; readonly id: string }
  | { readonly ok: false; readonly problems: readonly FileProblem[] };

const refuse = (problems: readonly FileProblem[]): ProjectFileImportOutcome => ({ ok: false, problems });

/**
 * Creates a project from the text of a project file (YAML or JSON). An overlay file extends a published template
 * and becomes the project's draft. A template file is published as a template version (identical content is a
 * no-op) and the project extends it. Any problem creates nothing.
 */
export function importProjectFile(
  deps: ProjectFileImportDeps,
  text: string,
  by: string,
  name?: string,
): ProjectFileImportOutcome {
  const read = parseText(text);
  if (!read.ok) return refuse(read.problems);
  const shape = read.value !== null && typeof read.value === 'object' && 'extends' in read.value;
  const parsed = (shape ? OverlayFileSchema : TemplateFileSchema).safeParse(read.value);
  if (!parsed.success) return refuse(parsed.error.issues.map((i) => problem(i.path.join('.'), i.message)));
  const { control, clock } = deps;
  const templates = controlTemplateSource(control);
  const make = (ref: string, projectName: string) =>
    createProjectFromTemplate(
      control,
      deps.openProjectDb,
      { name: projectName, description: '', template: ref },
      by,
      clock,
    );

  /** The draft extends the exact version it was made from (a creation ref is only `key@major`). */
  const pin = (key: string, template: string, version: string): void => {
    const store = createDraftStore(deps.openProjectDb(key));
    if (store.get())
      store.reset({
        template,
        templateVersion: version,
        overlay: stringify({ schema: 'ueberblick/1', extends: `${template}@${version}` }),
        by,
        at: clock.now(),
      });
  };

  if (shape) {
    const overlay = parsed.data as OverlayFile;
    const base = templates.resolve(overlay.extends);
    if (base === undefined)
      return refuse([problem('extends', `The template ${overlay.extends} does not exist.`)]);
    const effective = resolve(base, overlay);
    if (!effective.ok) return refuse(effective.problems);
    const project = make(overlay.extends, name ?? nameOf(base));
    const db = deps.openProjectDb(project.key);
    const store = createDraftStore(db);
    const draft = store.get();
    if (draft)
      store.reset({
        template: draft.template,
        templateVersion: draft.templateVersion,
        overlay: stringify(overlay),
        by,
        at: clock.now(),
      });
    return { ok: true, ...project };
  }

  const file = parsed.data as TemplateFile;
  const compiled = compile(file, { assets: NO_ASSETS });
  if (!compiled.ok) return refuse(compiled.problems.map((p) => problem(p.path, say(p.message))));
  // The same content under a published version is no conflict, whatever the key order of the stored text.
  const stored = templates.resolve(`${file.template.key}@${file.template.version}`);
  const same = stored !== undefined && isDeepStrictEqual(stored, file);
  if (!same) {
    const answer = publishTemplateVersion(control, controlCatalog(control), clock, stringify(file));
    if (!answer.ok)
      return refuse(
        'messages' in answer
          ? answer.messages.map((m) => problem('template', m))
          : [problem('template', 'The template cannot be published.')],
      );
  }
  const project = make(`${file.template.key}@${file.template.version.split('.')[0]}`, name ?? nameOf(file));
  pin(project.key, file.template.key, file.template.version);
  return { ok: true, ...project };
}

const nameOf = (file: TemplateFile): string =>
  localize(file.template.label, ['de', 'en']) || file.template.key;
