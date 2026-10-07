/**
 * The upgrade wizard's model (docs/08 "Upgrades templates", docs/05 "Upgrade semantics"): core's
 * `template.upgrade` decides what is automatic, a conflict or unresolved; this file only applies the
 * admin's choice per key and reports what is still open. Pure, no DOM, no I/O. Nothing here merges
 * by itself (R1): every value comes from `upgrade` or from the choice.
 */
import { stringify } from 'yaml';
import {
  merge,
  upgrade,
  type KeyPath,
  type MergeIssue,
  type OverlayFile,
  type TemplateFile,
  type UpgradeConflict,
} from '@ueberblick/core';

/** How to settle a key both sides changed: keep the project's value, or take the new template's. */
export const RESOLUTIONS = ['overlay', 'template'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** What to do with an entry whose target the new template removed: drop it, or keep it and fix it by hand. */
export const UNRESOLVED_CHOICES = ['drop', 'keep'] as const;
export type UnresolvedChoice = (typeof UNRESOLVED_CHOICES)[number];

export interface UpgradeInput {
  /** The template version the overlay is on now. */
  readonly old: TemplateFile;
  readonly overlay: OverlayFile;
  readonly next: TemplateFile;
}

export interface UpgradeSession {
  readonly conflicts: readonly UpgradeConflict[];
  readonly unresolved: readonly KeyPath[];
  /** Template changes that apply on their own. */
  readonly autoApplied: readonly KeyPath[];
}

export interface UpgradeChoices {
  readonly conflicts: Readonly<Record<KeyPath, Resolution | undefined>>;
  readonly unresolved: Readonly<Record<KeyPath, UnresolvedChoice | undefined>>;
}

export type UpgradeOutcome =
  | {
      readonly ok: true;
      readonly overlay: OverlayFile;
      /** The overlay as YAML text (comments of the old overlay are not kept). */
      readonly text: string;
      /** Merge problems of the result: a kept unresolved entry shows up here. */
      readonly issues: readonly MergeIssue[];
    }
  | { readonly ok: false; readonly pending: readonly KeyPath[] };

export function startUpgrade(input: UpgradeInput): UpgradeSession {
  const r = upgrade(input.old, input.overlay, input.next);
  return { conflicts: r.conflicts, unresolved: r.unresolved, autoApplied: r.autoApplied };
}

/** `overlay` without the entry at `path` (an override, an add or an input value). */
function without(overlay: OverlayFile, path: KeyPath): OverlayFile {
  const { override, add, inputs, ...rest } = overlay;
  const omit = <T>(map: Readonly<Record<string, T>> | undefined, key: string) => {
    if (map === undefined) return undefined;
    const copy = Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
    return Object.keys(copy).length > 0 ? copy : undefined;
  };
  const inputKey = path.startsWith('inputs.') ? path.slice('inputs.'.length) : undefined;
  const nextOverride = omit(override, path);
  const nextAdd = omit(add, path);
  const nextInputs = inputKey === undefined ? inputs : omit(inputs, inputKey);
  return {
    ...rest,
    ...(nextInputs ? { inputs: nextInputs } : {}),
    ...(nextOverride ? { override: nextOverride } : {}),
    ...(nextAdd ? { add: nextAdd } : {}),
  };
}

export function resolveUpgrade(input: UpgradeInput, choices: UpgradeChoices): UpgradeOutcome {
  const r = upgrade(input.old, input.overlay, input.next);
  const pending = [
    ...r.conflicts.filter((c) => choices.conflicts[c.path] === undefined).map((c) => c.path),
    ...r.unresolved.filter((p) => choices.unresolved[p] === undefined),
  ];
  if (pending.length > 0) return { ok: false, pending };
  let overlay = r.overlay;
  for (const c of r.conflicts)
    if (choices.conflicts[c.path] === 'template') overlay = without(overlay, c.path);
  for (const p of r.unresolved) if (choices.unresolved[p] === 'drop') overlay = without(overlay, p);
  return {
    ok: true,
    overlay,
    text: stringify(overlay),
    issues: merge(input.next, overlay).issues,
  };
}
