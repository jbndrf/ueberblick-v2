/**
 * The pure parts of Versions (docs/08 "Diffs and deploys", "Upgrades templates", "Keeps history"): plan against the
 * running config version, compare, upgrade the template, (the template publish check is `core.checkPublish`). The page is the Versionen page of
 * `apps/web` (WP-325); the lens UI is gone.
 */
export { getVersionsApi, setVersionsApi, VERSIONS_API_CONTEXT } from './api';
export type {
  DeployOutcome,
  DeployWarning,
  PlanOutcome,
  UpgradeOffer,
  VersionRow,
  VersionsApi,
  VersionsSnapshot,
} from './api';
export { buildPlan, mappingsComplete, missingMappings } from './plan';
export type { Mapping, MappingRequest, Plan, PlanEntity, PlanInput } from './plan';
export { parseOverlaySource } from './sources';
export type { ParsedSource } from './sources';
export { resolveUpgrade, startUpgrade, RESOLUTIONS, UNRESOLVED_CHOICES } from './upgrade';
export type { Resolution, UnresolvedChoice, UpgradeChoices, UpgradeInput, UpgradeOutcome } from './upgrade';
