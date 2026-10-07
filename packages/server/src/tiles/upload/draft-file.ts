import { parse } from 'yaml';
import { merge, OverlayFileSchema, type TemplateFile } from '@ueberblick/core';
import { createDraftStore } from '../../builder-draft';
import type { Db } from '../../db/driver';
import type { TemplateSource } from '../../deploy';

/**
 * The project file the working draft would deploy (its template merged with its overlay), or `undefined` when the
 * project has no draft or the draft does not parse. Reads only; a draft is never created here.
 */
export function draftTemplateFile(db: Db, templates: TemplateSource): TemplateFile | undefined {
  const draft = createDraftStore(db).get();
  if (draft === undefined) return undefined;
  const template = templates.resolve(`${draft.template}@${draft.templateVersion}`);
  if (template === undefined) return undefined;
  try {
    const overlay = OverlayFileSchema.safeParse(parse(draft.overlay));
    return overlay.success ? merge(template, overlay.data).file : undefined;
  } catch {
    return undefined;
  }
}
