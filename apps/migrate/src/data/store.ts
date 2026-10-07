/** A `Store` over a project database for the import project: composed by the server's one `composeProjectStore`. */
import { createGeo, type Clock, type Geo } from '@ueberblick/core';
import { composeProjectStore, createLogger, deployProject, type Db, type Store } from '@ueberblick/server';
import type { ImportTarget } from '../config';

export interface MigrationStore {
  readonly store: Store;
  readonly geo: Geo;
  /** The config version the runs are made against. */
  readonly configVersion: number;
}

/**
 * The store the runtime would compose (`composeProjectStore`), over the import project: its file is deployed through
 * `deployProject` first (a run needs a deployed version: floating features and creates take it), and the runs are made
 * against the version that deploy reports. Its timers hook is attached, so an `elapsed` rule of the import project
 * schedules its rows as the import runs. The import project carries no rules, so the timers of the real project are
 * scheduled when its file is deployed after the import (`deployProject` runs `rebuild`, docs/process/cutover-runbook.md).
 */
export function migrationStore(db: Db, target: ImportTarget, clock: Clock): MigrationStore {
  const deployed = deployProject(db, target.file, 'migrate', { clock, afterDeploy: () => undefined });
  if (!deployed.ok)
    throw new Error(`the import project does not deploy: ${deployed.problems[0]?.message ?? 'unknown'}`);
  const configVersion = deployed.version;
  const store = composeProjectStore(db, {
    clock,
    // The import writes its own report; the run log lines of a one-off migration go nowhere.
    log: createLogger({ sink: () => undefined, now: () => Date.now() }),
    config: (v) => (v === configVersion ? target.config : undefined),
    current: () => ({ version: configVersion, config: target.config }),
    // A one-off import has no blob store: it erases nothing and writes no file bytes.
    onOrphanedBlobs: () => undefined,
  });
  return { store, geo: createGeo(), configVersion };
}
