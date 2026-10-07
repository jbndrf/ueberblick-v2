/**
 * What the Status & Freigabe section shows (v3 `settings/+page.server.ts` `lifecycle` and `goLivePreview`): where the
 * draft stands against what is live, the Objekte per Objektart, and what keeps the draft from deploying. The status and the
 * blocker count are the publish bar's own (`draftStatus`); the blocker texts come from the same dry run (`plan`), so the
 * list and the bar always agree (R1).
 */
import { parse } from 'yaml';
import { localize, servedSql, type Problem, type TemplateFile } from '@ueberblick/core';
import {
  createDraftStore,
  deployedVersion,
  draftStatus,
  plan,
  type Db,
  type DeployInput,
} from '@ueberblick/server';
import { runtime } from '../../../../../../lib/server/runtime';
import type { LifecycleType, LifecycleView } from '../../../../../../lib/admin/settings/types';

const TYPE_OF_PATH = /^types\.([^.[\]]+)/;

function objectsByType(db: Db): Map<string, number> {
  const rows = db
    .prepare<{ type: string; n: number }>(
      `SELECT type, COUNT(*) AS n FROM features WHERE ${servedSql('lifecycle')} GROUP BY type`,
    )
    .all();
  return new Map(rows.map((r) => [r.type, r.n]));
}

/** The blockers of the saved draft; empty when there is none or it deploys. */
function blockersOf(db: Db): readonly Problem[] {
  const rt = runtime();
  const draft = createDraftStore(db).get();
  if (draft === undefined) return [];
  let overlay: unknown;
  try {
    overlay = parse(draft.overlay);
  } catch {
    return [];
  }
  const dry = plan(db, overlay as DeployInput, { clock: rt.clock, templates: rt.templates });
  return dry.ok ? [] : dry.problems;
}

export function loadLifecycle(projectKey: string, locale: string, file: TemplateFile | null): LifecycleView {
  const rt = runtime();
  const db = rt.projectDb(projectKey);
  const status = draftStatus(db, { clock: rt.clock, templates: rt.templates });
  const problems = status.problems > 0 ? blockersOf(db) : [];
  const counts = objectsByType(db);
  const byType = new Map<string, string[]>();
  const other: string[] = [];
  for (const p of problems) {
    const text = localize(p.message, [locale]);
    const type = TYPE_OF_PATH.exec(p.path)?.[1];
    if (type === undefined) other.push(text);
    else byType.set(type, [...(byType.get(type) ?? []), text]);
  }
  const types = Object.entries(file?.types ?? {}).map(([key, t]): LifecycleType => ({
    key,
    label: localize(t.label, [locale]) || key,
    objects: counts.get(key) ?? 0,
    blockers: byType.get(key) ?? [],
  }));
  return {
    version: deployedVersion(db)?.version ?? null,
    neverPublished: status.neverPublished,
    dirty: status.dirty,
    types,
    other,
    blockerCount: Math.max(status.problems, problems.length),
  };
}
