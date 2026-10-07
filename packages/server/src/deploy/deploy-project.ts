import type { Db } from '../db/driver';
import type { DeployDeps, DeployInput, DeployResult, ValueMapping, VersionChoices } from './contract';
import { enqueuePacks } from '../packs/store';
import { deploy } from './deploy';
import { loadData } from './versions';

/** What `deployProject` needs beyond the pipeline: the side effects of a new running config. */
export interface DeployProjectDeps extends DeployDeps {
  /**
   * `ProjectServices.afterDeploy` of the project: rebuilds the timers of the elapsed rules and adds the missing
   * cron rows. Called only when the running config changed.
   */
  afterDeploy(): void;
}

/**
 * The one way to put a config version into service (WP-169). It runs `deploy` and then every side effect a new
 * running config needs, so a deploy from the admin API, the builder (deploy, rollback, upgrade) or a tool cannot
 * leave stale timers. `mappings` are the `{ to }` / `{ discard }` choices of a breaking deploy; `{ to }` ones are recorded
 * as `deploy_moves` rows that `afterDeploy` lets the move executor run (WP-307). `choices` is the per-type "belassen / verschieben" (WP-317, `pins.ts`): a `keep` pins the running features inside the deploy transaction through `deps.pins`. Nothing else calls `deploy` (a grep test in `deploy-project.spec.ts` guards it).
 */
export function deployProject(
  db: Db,
  file: DeployInput,
  by: string,
  deps: DeployProjectDeps,
  mappings?: Readonly<Record<string, ValueMapping>>,
  choices?: VersionChoices,
): DeployResult {
  const { afterDeploy, ...pipeline } = deps;
  const r = deploy(db, file, by, pipeline, mappings, choices);
  // The same file deployed again changes nothing and needs nothing.
  if (r.ok && (r.created || r.diff.length > 0)) {
    afterDeploy();
    // Offline packs (WP-350): queue the pack builds of the new config; the same hash is already built or queued.
    const data = loadData(db, r.version);
    if (data === undefined) throw new Error(`deployed version ${r.version} has no stored config`);
    enqueuePacks(db, data.file, deps.clock.now());
  }
  return r;
}
