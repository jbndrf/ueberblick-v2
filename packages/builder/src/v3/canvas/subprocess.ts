/**
 * Sub-process links (owner answer S4-5): a task offered on the parent Objektart that creates a feature of
 * another Objektart, tied to the parent by a declared relation, starts that Objektart's own process. One pure
 * function of the project file, so the parent's canvas (the 'verknüpft' marker), the child's canvas (the link
 * back) and the specs all read the same answer (R1). Nothing is stored.
 */
import type { TemplateFile } from '@ueberblick/core';
import { taskOfferedOn, type TaskDef } from '../../lenses/process/graph';
import { labelOf } from '../../shell/location';

export interface SubprocessLink {
  /** The task, offered on the parent, that creates the child. */
  readonly task: string;
  readonly parent: string;
  readonly parentLabel: string;
  readonly child: string;
  /** The child's process name: its Objektart's label (one process per Objektart). */
  readonly childLabel: string;
  /** The child's reference property that points at the parent (the declared relation). */
  readonly relation: string;
}

type FeatureType = NonNullable<TemplateFile['types']>[string];

/** The child's reference property to `parent` that the task fills or that the parent's reverse list names. */
function relationOf(
  file: TemplateFile,
  task: TaskDef,
  parent: string,
  child: string,
  childType: FeatureType,
): string | undefined {
  const refs = Object.entries(childType.properties ?? {}).filter(
    ([, p]) => p.type === 'reference' && p.to === parent,
  );
  const filled = new Set((task.then ?? []).flatMap((s) => Object.keys(s.set ?? {})));
  const reverse = new Set(
    Object.values(file.types?.[parent]?.relations ?? {}).flatMap((r) =>
      r.inverse_of === undefined ? [] : [r.inverse_of],
    ),
  );
  return refs.find(([key]) => filled.has(key) || reverse.has(`${child}.${key}`))?.[0];
}

/** Every sub-process link of the project, in task order. */
export function subprocessLinks(file: TemplateFile, locale: string): SubprocessLink[] {
  const types = file.types ?? {};
  const links: SubprocessLink[] = [];
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const child = task.creates;
    const childType = child === undefined ? undefined : types[child];
    if (child === undefined || childType === undefined) continue;
    for (const parent of Object.keys(types)) {
      if (parent === child || !taskOfferedOn(task, parent)) continue;
      const relation = relationOf(file, task, parent, child, childType);
      if (relation === undefined) continue;
      links.push({
        task: key,
        parent,
        parentLabel: labelOf(types[parent]?.label, locale, parent),
        child,
        childLabel: labelOf(childType.label, locale, child),
        relation,
      });
    }
  }
  return links;
}

/** The links that leave `type`, by task: what the parent's canvas marks. */
export const childLinks = (links: readonly SubprocessLink[], type: string): SubprocessLink[] =>
  links.filter((l) => l.parent === type);

/** The parents of `type`, each Objektart once: what the child's canvas links back to. */
export function parentLinks(links: readonly SubprocessLink[], type: string): SubprocessLink[] {
  const seen = new Set<string>();
  return links.filter((l) => l.child === type && !seen.has(l.parent) && seen.add(l.parent));
}
