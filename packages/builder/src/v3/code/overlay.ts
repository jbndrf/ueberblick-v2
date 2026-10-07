/**
 * The "Anpassungen" text of one Objektart (WP-440, register Q7 a): the raw overlay entries that concern it,
 * read from the Doc's own overlay (`Doc.overlay()`, no second computation, R1). An entry concerns the
 * Objektart when its key path sits at or below the type or one of its tasks (an automatic action sits below its
 * task); a task the overlay hides still counts, because the template offers it on this Objektart.
 */
import { parseKeyPath } from '@ueberblick/core';
import { stringify } from 'yaml';
import { openProject, type Doc } from '../../doc';
import { scopeOf } from './scope';

const SECTIONS = ['types', 'tasks'] as const;
type Section = (typeof SECTIONS)[number];
/** The overlay file's entry maps that name key paths. */
const MAPS = ['override', 'add', 'order'] as const;

/** The scope of the template alone (an empty overlay): what the Objektart offered before the project changed it. */
function templateScope(doc: Doc, type: string, locale: string) {
  const empty = `schema: ueberblick/1\nextends: ${doc.overlay().extends}\n`;
  return scopeOf(openProject(doc.templateSrc, empty), type, locale);
}

/** True when the template has something a project could have changed; the empty project (`leer`) has not. */
export const hasTemplateContent = (doc: Doc): boolean =>
  SECTIONS.some((s) => Object.keys(doc.template[s] ?? {}).length > 0);

/** The overlay text of `type`; `''` when the project changed nothing there; `undefined` without template content. */
export function overlayYaml(doc: Doc, type: string, locale: string): string | undefined {
  if (!hasTemplateContent(doc)) return undefined;
  const now = scopeOf(doc, type, locale);
  const was = templateScope(doc, type, locale);
  const keys: Record<Section, ReadonlySet<string>> = {
    types: new Set([type]),
    tasks: new Set([...(now?.tasks ?? []), ...(was?.tasks ?? [])]),
  };
  const concerns = (path: string): boolean => {
    const [section, key] = parseKeyPath(path) ?? [];
    return (
      section !== undefined &&
      key !== undefined &&
      (SECTIONS as readonly string[]).includes(section) &&
      keys[section as Section].has(key)
    );
  };
  const overlay = doc.overlay();
  const out: Record<string, unknown> = {};
  for (const m of MAPS) {
    const entries = Object.entries(overlay[m] ?? {}).filter(([path]) => concerns(path));
    if (entries.length > 0) out[m] = Object.fromEntries(entries);
  }
  const hide = (overlay.hide ?? []).filter(concerns);
  if (hide.length > 0) out['hide'] = hide;
  return Object.keys(out).length === 0 ? '' : stringify(out, { lineWidth: 0 });
}
