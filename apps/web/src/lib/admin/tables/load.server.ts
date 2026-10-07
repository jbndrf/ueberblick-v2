/**
 * What the Tabellen pages need from the server (v3 `custom-tables/+page.server.ts` and `[tableId]/+page.server.ts`
 * loads): the tables and columns from the project's **draft** (a table or column added there shows in the lists at once,
 * the publish bar tells it is not live), and the type as **deployed** for the grid (the list API reads the deployed
 * config). Nothing here loads a row: the grid asks the list API, page by page.
 */
import { draftSources, ensureDraft } from '@ueberblick/server';
import { localize, merge, OverlayFileSchema, TemplateFileSchema, type TemplateFile } from '@ueberblick/core';
import { parse } from 'yaml';
import { runtime } from '../../server/runtime';
import { loadDraft } from '../draft/draft-source.server';
import { loadImportSetup, type ImportSetupData } from '../import/setup.server';
import { actorNamesOf } from '../actor-names';
import { actorSourcesOf } from '../actor-names.server';
import { columnsOf, summariesOf, type TableColumnDef, type TableSummary } from './model';

type TypeDef = NonNullable<TemplateFile['types']>[string];

export interface RoleChoice {
  readonly key: string;
  readonly label: string;
}

/** The draft's effective file (created from the deployed version on first use, as the sidebar does), or null. */
export function draftFileOf(project: string, accountId: string): TemplateFile | null {
  const rt = runtime();
  const opened = ensureDraft(rt.projectDb(project), rt.clock, accountId);
  const sources = opened.ok ? draftSources(opened.draft, rt.templates) : null;
  if (sources === null || sources === undefined) return null;
  try {
    return merge(
      TemplateFileSchema.parse(parse(sources.templateSrc)),
      OverlayFileSchema.parse(parse(sources.overlaySrc)),
    ).file;
  } catch {
    return null;
  }
}

export const rolesOf = (file: TemplateFile, locale: string): RoleChoice[] =>
  Object.entries(file.roles ?? {}).map(([key, r]) => ({ key, label: localize(r.label, [locale]) || key }));

export interface OverviewData {
  readonly tables: readonly TableSummary[];
  readonly roles: readonly RoleChoice[];
}

export function loadOverview(project: string, accountId: string, locale: string): OverviewData {
  const file = draftFileOf(project, accountId);
  return file === null
    ? { tables: [], roles: [] }
    : { tables: summariesOf(file, locale), roles: rolesOf(file, locale) };
}

export interface TablePageData {
  readonly summary: TableSummary;
  readonly columns: readonly TableColumnDef[];
  readonly roles: readonly RoleChoice[];
  /** The table as deployed: what the grid shows. Null before its first publish. */
  readonly deployed: TypeDef | null;
  /** Actor id to name, for "Erstellt von" and participant columns. */
  readonly names: Readonly<Record<string, string>>;
  /** The CSV wizard's targets (owner A8): the deployed type when it is deployed, else the draft's. */
  readonly importing: ImportSetupData;
}

/** The page of one table; null when the draft has no such table. */
export function loadTablePage(
  project: string,
  accountId: string,
  locale: string,
  table: string,
): TablePageData | null {
  const file = draftFileOf(project, accountId);
  const def = file?.types?.[table];
  if (file === null || def === undefined) return null;
  const rt = runtime();
  const deployedType = rt.services.deployed(project)?.config.file.types?.[table] ?? null;
  const summary = summariesOf(file, locale).find((s) => s.key === table);
  if (summary === undefined) return null;
  const names = deployedType === null ? {} : actorNamesOf(actorSourcesOf(project));
  return {
    summary,
    columns: columnsOf(def, locale, deployedType ?? undefined),
    roles: rolesOf(file, locale),
    deployed: deployedType,
    names,
    importing: loadImportSetup(
      { deployed: () => rt.services.deployed(project)?.config.file, draft: () => loadDraft(project) },
      table,
      locale,
      { table: true },
    ),
  };
}
