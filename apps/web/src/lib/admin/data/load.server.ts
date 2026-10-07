import type { LocalizedString, TemplateFile } from '@ueberblick/core';
import { actorNamesOf, type ActorSources } from '../actor-names';
import { previewBasemap, type PreviewBasemap } from './tile-underlay';

type TypeDef = NonNullable<TemplateFile['types']>[string];

export interface LoadDeps {
  /** The type as deployed (the list API reads the deployed config); undefined before its first publish. */
  deployedType(project: string, type: string): TypeDef | undefined;
  /** The deployed project file's map config. */
  deployedMap(project: string): TemplateFile['map'] | undefined;
  /** The project's participants and admin accounts (one read per page load, not per row). */
  actors(project: string): ActorSources;
  /** The deployed project file's roles (the label of a `role` property's value in a cell). */
  deployedRoles(project: string): TemplateFile['roles'] | undefined;
}

export interface DataPageData {
  readonly type: TypeDef | null;
  readonly published: boolean;
  /** The project's deployed base layer as plain tiles (Standort preview); null when there is none to draw. */
  readonly basemap: PreviewBasemap | null;
  /** Actor id to name (participants, admins), for "Erstellt von" and participant properties. */
  readonly names: Readonly<Record<string, string>>;
  /** Role key to its labels, for `role` properties. */
  readonly roleLabels: Readonly<Record<string, LocalizedString>>;
}

/** What the data page of one Objektart needs besides the rows (the rows come from the list API, page by page). */
export function loadDataPage(deps: LoadDeps, project: string, type: string): DataPageData {
  const def = deps.deployedType(project, type);
  const names = def === undefined ? {} : actorNamesOf(deps.actors(project));
  return {
    type: def ?? null,
    published: def !== undefined,
    basemap: previewBasemap(deps.deployedMap(project), project),
    names,
    roleLabels: Object.fromEntries(
      Object.entries(deps.deployedRoles(project) ?? {}).map(([key, role]) => [key, role.label]),
    ),
  };
}
