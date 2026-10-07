/**
 * The Code view's engine for one Objektart (WP-379): the effective YAML of the type with its tasks (and their
 * automatic actions) in the template file's own shape (`types:` / `tasks:`), a provenance per line, and the
 * overlay ops an edited text stands for. It reuses WP-332's entity diff and its checks (`entity-yaml.ts`),
 * so there is one YAML-to-ops path (R1); what it adds is the entity level: a new key below `tasks:` is an `add`, a removed one a `hide` (template entity) or a `reset` (overlay entity).
 */
import { LineCounter, parseDocument, stringify } from 'yaml';
import { formatKeyPath, type KeyPath } from '@ueberblick/core';
import type { Doc, EntityYamlLine, EntityYamlProblem, Op } from './contract';
import { checkOps, diff, fail, isData, lineMap, problem, type Data } from './entity-yaml';
import { sameData, valueAt } from './ops';

/** What the Code view of one Objektart shows: the type, and the keys of its tasks (each with its `auto` entries). */
export interface TypeScope {
  readonly type: string;
  readonly tasks: readonly string[];
}

export interface TypeYaml {
  readonly text: string;
  /** One entry per line of `text`. */
  readonly lines: readonly EntityYamlLine[];
}

export type TypeYamlResult =
  | { readonly ok: true; readonly ops: readonly Op[] }
  | { readonly ok: false; readonly problems: readonly EntityYamlProblem[] };

const SECTIONS = ['types', 'tasks'] as const;

/** The data the text stands for: `types.<type>` and the scoped tasks of the effective file. */
function compose(doc: Doc, scope: TypeScope): Data {
  const file = doc.effective() as unknown as Record<string, Data | undefined>;
  const pick = (section: string, keys: readonly string[]): Data =>
    Object.fromEntries(
      keys.flatMap((k) => {
        const v = file[section]?.[k];
        return v === undefined ? [] : [[k, v]];
      }),
    );
  const out: Data = { types: pick('types', [scope.type]) };
  if (scope.tasks.length > 0) out.tasks = pick('tasks', scope.tasks);
  return out;
}

export function typeYaml(doc: Doc, scope: TypeScope): TypeYaml {
  const text = stringify(compose(doc, scope), { lineWidth: 0 });
  return { text, lines: provenanceLines(doc, text) };
}

/**
 * The provenance of every line of `text` (an edited text too): the gutter follows the typing. `base` is the
 * key path the text's root sits at (none for the Objektart text, an entity's segments for an entity text).
 */
export function provenanceLines(doc: Doc, text: string, base: readonly string[] = []): EntityYamlLine[] {
  return lineMap(text, base).map((p, i): EntityYamlLine => ({
    line: i + 1,
    path: p,
    provenance: doc.provenance(p),
  }));
}

/** The 1-based line of the deepest key of `path` that `text` has; line 1 when none. */
function lineOfPath(text: string, path: KeyPath): number {
  const map = lineMap(text, []);
  for (let p: string = path; p !== ''; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : '') {
    const at = map.indexOf(p);
    if (at >= 0) return at + 1;
  }
  return 1;
}

const withLine = (text: string, p: EntityYamlProblem): EntityYamlProblem =>
  p.line === undefined ? { ...p, line: lineOfPath(text, p.path), column: 1 } : p;

const mapOf = (section: string, text: string): EntityYamlProblem =>
  withLine(
    text,
    problem(section, 'schema_invalid', `${section} is a map of keys.`, 'write key: value lines'),
  );

export function applyTypeYaml(doc: Doc, scope: TypeScope, text: string): TypeYamlResult {
  const lc = new LineCounter();
  const parsed = parseDocument(text, { lineCounter: lc });
  if (parsed.errors.length > 0) {
    return fail(
      parsed.errors.map((e) => {
        const [pos] = e.linePos ?? [];
        return {
          ...problem('', 'schema_invalid', e.message, 'fix the YAML at this position'),
          ...(pos ? { line: pos.line, column: pos.col } : {}),
        };
      }),
    );
  }
  const next: unknown = parsed.toJS();
  if (!isData(next)) {
    return fail([
      {
        ...problem('', 'schema_invalid', 'The text is a map of keys.', 'write types: / tasks:'),
        line: 1,
        column: 1,
      },
    ]);
  }
  const old = compose(doc, scope);
  const problems: EntityYamlProblem[] = [];
  const ops: Op[] = [];
  for (const key of Object.keys(next)) {
    if (!(SECTIONS as readonly string[]).includes(key)) {
      problems.push(
        withLine(
          text,
          problem(key, 'unknown_path', `${key} is not a section of an Objektart.`, 'use types or tasks'),
        ),
      );
    }
  }
  for (const section of SECTIONS) {
    const was = old[section];
    const now = next[section];
    const wasMap: Data = isData(was) ? was : {};
    if (now !== undefined && now !== null && !isData(now)) {
      problems.push(mapOf(section, text));
      continue;
    }
    const nowMap: Data = isData(now) ? now : {};
    for (const [k, v] of Object.entries(nowMap)) {
      const path = formatKeyPath([section, k]);
      const before = wasMap[k];
      if (!(k in wasMap)) {
        if (section === 'types') {
          problems.push(
            withLine(
              text,
              problem(
                path,
                'unknown_path',
                `${path} is not this Objektart.`,
                'this view edits one Objektart',
              ),
            ),
          );
        } else if (!isData(v)) problems.push(mapOf(path, text));
        else if ((doc.overlay().hide ?? []).includes(path)) {
          // A hidden template entity comes back as it was; changing it as well is a second edit.
          if (sameData(valueAt(doc.template, [section, k]), v)) ops.push({ kind: 'unhide', path });
          else {
            problems.push(
              withLine(
                text,
                problem(
                  path,
                  'unknown_path',
                  `${path} was removed; bring it back first.`,
                  'copy it from the template',
                ),
              ),
            );
          }
        } else ops.push({ kind: 'add', path, value: v });
      } else if (isData(v) && isData(before)) diff(doc, before, v, [section, k], ops);
      else if (!sameData(before, v)) problems.push(mapOf(path, text));
    }
    for (const k of Object.keys(wasMap)) {
      if (k in nowMap) continue;
      const path = formatKeyPath([section, k]);
      if (section === 'types') {
        problems.push({
          ...problem(path, 'unknown_path', `${path} cannot be removed here.`, 'keep the Objektart'),
          line: 1,
          column: 1,
        });
      } else
        ops.push(
          valueAt(doc.template, [section, k]) !== undefined
            ? { kind: 'hide', path }
            : { kind: 'reset', path },
        );
    }
  }
  if (problems.length > 0) return fail(problems);
  const checked = checkOps(doc, ops);
  return checked.ok ? checked : fail(checked.problems.map((p) => withLine(text, p)));
}
