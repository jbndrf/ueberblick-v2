/**
 * The dialog of "Auf aktuelle Version verschieben" (WP-368, owner P3) as the deploy overview's own shapes (R1): the
 * differences between the pinned version and the deployed one that touch the pinned Objekte, grouped per Objektart with
 * "verschieben nach / Werte verwerfen" rows (`DeployGroup`). Every count comes from the engine's `planPinMove`; this
 * only arranges them. Server side (it reads both stored files).
 */
import { loadConfig, type Db, type PinMovePlan } from '@ueberblick/server';
import { localize, type LocalizedString, type TemplateFile } from '@ueberblick/core';
import { groupsOf, mappingsOf, type MappingRequirement } from './plan-view';
import type { DeployPlan } from './types';

/** What the dialog shows: the moved Objekte per Objektart and the questions the differences ask. */
export interface PinMoveView {
  readonly from: number;
  readonly to: number;
  readonly pinned: number;
  readonly types: readonly { readonly type: string; readonly label: string; readonly count: number }[];
  /** `groups` and `mappings` only hold breaking differences that touch a pinned Objekt; no choices, no blockers. */
  readonly plan: DeployPlan;
}

/** The builder's mapping requirements of two files (`buildPlan(...).mappings`); the route passes it in, the builder stays out of `lib/`. */
export type RequirementsOf = (before: TemplateFile, after: TemplateFile) => readonly MappingRequirement[];

export function pinMoveView(
  db: Db,
  move: PinMovePlan,
  locale: string,
  requirementsOf: RequirementsOf,
): PinMoveView {
  const before = loadConfig(db, move.from)?.file;
  const after = loadConfig(db, move.to)?.file;
  if (before === undefined || after === undefined)
    throw new Error('a version of the move has no stored config');
  const input = {
    before,
    after,
    diff: move.diff.filter((e) => e.breaking && (e.affected ?? 0) > 0),
    versions: [],
    affected: move.types.map((t) => ({ type: t.type, features: t.count })),
    locale,
  };
  return {
    from: move.from,
    to: move.to,
    pinned: move.pinned,
    types: move.types.map((t) => ({
      type: t.type,
      count: t.count,
      label: localize(after.types?.[t.type]?.label as LocalizedString | undefined, [locale]) || t.type,
    })),
    plan: {
      revision: null,
      first: false,
      warnings: [],
      groups: groupsOf(input),
      versions: [],
      mappings: mappingsOf(input, requirementsOf(before, after)),
      blockers: [],
    },
  };
}
