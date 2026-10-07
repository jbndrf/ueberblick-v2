import { parse } from 'yaml';
import { merge, OverlayFileSchema, type TemplateFile } from '@ueberblick/core';
import { createDraftStore } from '../../builder-draft/store';
import type { TemplateSource } from '../../deploy/contract';
import type { Db } from '../../db/driver';

const keysOf = (roles: unknown): string[] =>
  typeof roles === 'object' && roles !== null && !Array.isArray(roles) ? Object.keys(roles) : [];

const safeParse = (yaml: string): unknown => {
  try {
    return parse(yaml);
  } catch {
    return undefined;
  }
};

/**
 * The role keys a participant may carry: the roles of the deployed config plus those of the draft (the draft's template merged with its
 * overlay; needs `templates` to resolve the template). Participants apply at once and are not part of the draft
 * (Q13), so a role an admin just added in the builder is already valid. `undefined` when the project has neither a
 * deployed config nor a draft: there is no role list to check against yet.
 */
export function knownRoles(db: Db, templates?: TemplateSource): ReadonlySet<string> | undefined {
  const out = new Set<string>();
  let any = false;
  const deployed = db
    .prepare<{ compiled: string }>("SELECT compiled FROM config_versions WHERE status = 'deployed'")
    .get();
  if (deployed) {
    any = true;
    const data = JSON.parse(deployed.compiled) as { file?: { roles?: unknown } };
    for (const k of keysOf(data.file?.roles)) out.add(k);
  }
  const draft = createDraftStore(db).get();
  if (draft) {
    any = true;
    const base: TemplateFile | undefined = templates?.resolve(`${draft.template}@${draft.templateVersion}`);
    const overlay = OverlayFileSchema.safeParse(safeParse(draft.overlay));
    // The roles of the merged config (template plus overlay): core's merge is the one definition of "the effective
    // config"; a draft in progress that does not parse or merge simply has no extra roles yet.
    const merged = base && overlay.success ? merge(base, overlay.data).file : base;
    for (const k of keysOf(merged?.roles)) out.add(k);
  }
  return any ? out : undefined;
}
