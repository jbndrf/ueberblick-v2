import { parse } from 'yaml';
import { merge, OverlayFileSchema, type Problem } from '@ueberblick/core';
import type { Db } from '../db/driver';
import { deployedVersion, plan, type TemplateSource } from '../deploy';
import { createDraftStore } from './store';

/**
 * Where a project's draft stands against what is deployed (E-13). Only the draft and the deployed
 * version count: the participants and their roles are not part of the draft (Q13).
 */
export interface DraftStatus {
  /** The draft differs from the deployed version (or, before the first publish, there is a draft to publish). */
  readonly dirty: boolean;
  /** Nothing is deployed yet (Q17): nothing is live. */
  readonly neverPublished: boolean;
  /** How many problems keep the draft from deploying. */
  readonly problems: number;
  /** The draft's revision, which a deploy names; null when there is no draft. */
  readonly revision: number | null;
  /** The Objektart to open for those problems or for a value move (the first problem's, else the first one); null when none is known. */
  readonly type: string | null;
}

const NONE = { problems: 0, revision: null, type: null } as const;
const TYPE_OF_PATH = /^types\.([^.[\]]+)/;

const typeOf = (problems: readonly Problem[]): string | null => {
  for (const p of problems) {
    const m = TYPE_OF_PATH.exec(p.path);
    if (m) return m[1] as string;
  }
  return null;
};

/** The status of the project's draft. Reads only; a draft is never created here. */
export function draftStatus(
  db: Db,
  deps: { readonly clock: { now(): string }; readonly templates: TemplateSource },
): DraftStatus {
  const deployed = deployedVersion(db);
  const neverPublished = deployed === undefined;
  const draft = createDraftStore(db).get();
  if (draft === undefined) return { dirty: false, neverPublished, ...NONE };
  const base = { neverPublished, revision: draft.revision };

  let overlay: unknown;
  try {
    overlay = parse(draft.overlay);
  } catch {
    return { dirty: true, ...base, problems: 1, type: null };
  }
  const parsed = OverlayFileSchema.safeParse(overlay);
  if (!parsed.success) return { dirty: true, ...base, problems: parsed.error.issues.length, type: null };

  const dry = plan(db, parsed.data, deps);
  if (!dry.ok) return { dirty: true, ...base, problems: dry.problems.length, type: typeOf(dry.problems) };
  const clean = deployed !== undefined && dry.version === deployed.version && dry.diff.length === 0;
  const template = deps.templates.resolve(`${draft.template}@${draft.templateVersion}`);
  const first = template ? Object.keys(merge(template, parsed.data).file.types ?? {})[0] : undefined;
  return { dirty: !clean, ...base, problems: 0, type: first ?? null };
}
