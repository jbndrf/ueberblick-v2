export type {
  BreakingChange,
  KeyPath,
  MergeIssue,
  MergeResult,
  TemplateApi,
  UpgradeConflict,
  UpgradeResult,
} from './contract';
import type { TemplateApi } from './contract';
import { breakingChanges } from './breaking';
import { merge } from './merge';
import { upgrade } from './upgrade';

export { breakingChanges, merge, upgrade };
export { lockedBy } from './lock';
export { formatKeyPath, parseKeyPath } from './paths';

/** The template API as one object, for ports and tests that take a `TemplateApi`. */
export const templateApi: TemplateApi = { merge, upgrade, breakingChanges };
export { checkPublish, compareVersions } from './publish';
export type { PublishCheck, PublishOutcome } from './publish';
