/**
 * Which project file the wizard maps onto (server only): the deployed one when the type is deployed, because the import
 * runs on the deployed version; the draft's effective file otherwise, so a type that was never published still gets its
 * wizard (A4: the import then waits for 'Veröffentlichen').
 */
import { merge, OverlayFileSchema, TemplateFileSchema, type TemplateFile } from '@ueberblick/core';
import { parse } from 'yaml';
import { importSetupOf, type ImportSetup } from './setup';

export interface ImportSetupData {
  readonly setup: ImportSetup | null;
  /** The type is in the deployed version; false means the import waits for the first 'Veröffentlichen' of it. */
  readonly published: boolean;
}

export interface ImportSetupDeps {
  deployed(): TemplateFile | undefined;
  draft(): { readonly templateSrc: string; readonly overlaySrc: string } | null;
}

function draftFile(draft: ReturnType<ImportSetupDeps['draft']>): TemplateFile | undefined {
  if (draft === null) return undefined;
  try {
    const template = TemplateFileSchema.parse(parse(draft.templateSrc));
    const overlay = OverlayFileSchema.parse(parse(draft.overlaySrc));
    return merge(template, overlay).file;
  } catch {
    return undefined;
  }
}

export function loadImportSetup(
  deps: ImportSetupDeps,
  type: string,
  locale: string,
  options: { readonly table?: boolean } = {},
): ImportSetupData {
  const deployed = deps.deployed();
  if (deployed?.types?.[type] !== undefined)
    return { setup: importSetupOf(deployed, type, locale, options), published: true };
  const draft = draftFile(deps.draft());
  return {
    setup: draft === undefined ? null : importSetupOf(draft, type, locale, options),
    published: false,
  };
}
