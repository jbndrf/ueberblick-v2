/**
 * Creates a project from a template (WP-309): the one server function behind `POST /api/admin/projects` and
 * the operator CLI. The project is ready to configure at once: it has a draft made from the template and no
 * deployed version (nothing is live before the first deploy).
 */
import { stringify } from 'yaml';
import { KeySchema, RESERVED_PROJECT_KEYS } from '@ueberblick/core';
import { seedDraft } from '../builder-draft';
import type { Db } from '../db/driver';
import { controlTemplateSource, ensureBuiltinTemplates } from '../templates';
import { createProject } from './bootstrap';

/** The role the creating admin gets in the new project. Roles are template-defined keys; this one is the creator's. */
const CREATOR_ROLE = 'admin';
const TEMPLATE_REF = /^[a-z][a-z0-9_]*@\d+$/;
const MAX_NAME = 200;

export interface NewProject {
  readonly name: string;
  readonly description: string;
  /** `key@major`, e.g. `leer@1`. */
  readonly template: string;
}

export interface FieldProblem {
  readonly field: 'name' | 'description' | 'template';
  readonly message: string;
}

/** `"Bäume Süd"` becomes `baeume_sued`: umlauts spelled out, everything else folded to `[a-z0-9_]`. */
export function projectKeyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const key = /^[a-z]/.test(slug) ? slug : `projekt_${slug}`.replace(/_$/, '');
  return key.slice(0, 60).replace(/_+$/, '');
}

/** The field problems of a request; empty means the input can be created. */
export function validateNewProject(
  control: Db,
  input: NewProject,
  clock: { now(): string },
): readonly FieldProblem[] {
  const problems: FieldProblem[] = [];
  const name = input.name.trim();
  if (name === '') problems.push({ field: 'name', message: 'Der Name darf nicht leer sein.' });
  else if (name.length > MAX_NAME) problems.push({ field: 'name', message: 'Der Name ist zu lang.' });
  if (!TEMPLATE_REF.test(input.template)) {
    problems.push({
      field: 'template',
      message: 'Eine Vorlage hat die Form schluessel@major, z. B. leer@1.',
    });
  } else {
    ensureBuiltinTemplates(control, clock);
    if (!controlTemplateSource(control).resolve(input.template))
      problems.push({ field: 'template', message: `Die Vorlage ${input.template} gibt es nicht.` });
  }
  return problems;
}

function freeKey(control: Db, name: string): string {
  const base = KeySchema.safeParse(projectKeyFromName(name)).success ? projectKeyFromName(name) : 'projekt';
  const taken = (k: string): boolean =>
    (RESERVED_PROJECT_KEYS as readonly string[]).includes(k) ||
    control.prepare('SELECT 1 AS n FROM projects WHERE key = ?').get(k) !== undefined ||
    control.prepare('SELECT 1 AS n FROM retired_projects WHERE key = ?').get(k) !== undefined; // WP-388: never reused
  if (!taken(base)) return base;
  for (let n = 2; ; n++) if (!taken(`${base}_${n}`)) return `${base}_${n}`;
}

/**
 * Generates the key from the name, creates the project row and database, seeds the draft with
 * `{ schema, extends: template }` and gives `by` (an account id) a membership. Throws on invalid input; call
 * `validateNewProject` first to get field problems.
 */
export function createProjectFromTemplate(
  control: Db,
  openProjectDb: (key: string) => Db,
  input: NewProject,
  by: string,
  clock: { now(): string },
): { readonly id: string; readonly key: string } {
  const problems = validateNewProject(control, input, clock);
  if (problems.length > 0) throw new Error(problems.map((p) => `${p.field}: ${p.message}`).join('; '));
  const file = controlTemplateSource(control).resolve(input.template);
  if (!file) throw new Error(`template ${input.template} is not available`);
  const key = freeKey(control, input.name);
  const project = control.transaction(() => {
    const p = createProject(control, { key, name: input.name.trim(), description: input.description }, clock);
    control
      .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
      .run(by, p.id, CREATOR_ROLE);
    return p;
  });
  seedDraft(openProjectDb(key), {
    template: file.template.key,
    templateVersion: file.template.version,
    overlay: stringify({ schema: 'ueberblick/1', extends: input.template }),
    by,
    at: clock.now(),
  });
  return project;
}
