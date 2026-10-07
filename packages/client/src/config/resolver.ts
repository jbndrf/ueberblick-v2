/**
 * The one resolver from a feature to the config it follows (A-029 item 2, R1): the planner and the participant
 * reader both ask it, so what the UI offers is what the planner will accept. A feature follows the `version` the
 * sync sent with it (`FeatureState.version`), else the deployed version; a create (`NEW_FEATURE`) the deployed one.
 * Before the first sync header there is no deployed version: `fallback` (the run's or the bootstrap's own) stands
 * in. Resolving is one map lookup per call (`ConfigVersions.get`), never a scan.
 */
import { NEW_FEATURE, type ConfigFor, type ResolvedConfig } from '@ueberblick/core/plan';
import { compilePerms } from '@ueberblick/core/perms';
import type { FeatureId } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import type { ConfigVersions } from './contract';

/** Thrown out of `configFor` when a version a plan touches is not readable yet (`'refetching'`). */
export class AwaitingConfig extends Error {
  constructor(readonly version: number) {
    super(`config version ${version} is not on this device yet`);
  }
}

export interface FeatureConfigsDeps {
  readonly versions: Pick<ConfigVersions, 'get'> & Partial<Pick<ConfigVersions, 'deployed'>>;
  readonly facts: Pick<Facts, 'feature'>;
  /** The version a create and a floating feature follow before the first header names the deployed one. */
  readonly fallback: number;
}

export interface FeatureConfigs {
  /** The deployed version, else the fallback. */
  readonly deployed: number;
  /** The version a feature (or a create) follows. */
  versionFor(feature: FeatureId | typeof NEW_FEATURE): number;
  /** The resolved config of the version, or `undefined` while it is not on the device. */
  of(feature: FeatureId | typeof NEW_FEATURE): ResolvedConfig | undefined;
  /** For `planFor`: like `of`, but throws `AwaitingConfig` for a version not on the device. */
  readonly configFor: ConfigFor;
}

/** Perms and the resolved pair are built once per compiled config (a config is immutable). */
const resolved = new WeakMap<object, ResolvedConfig>();

export function createFeatureConfigs(deps: FeatureConfigsDeps): FeatureConfigs {
  const { versions, facts } = deps;
  const deployed = (): number => versions.deployed ?? deps.fallback;
  const versionFor = (f: FeatureId | typeof NEW_FEATURE): number =>
    f === NEW_FEATURE ? deployed() : (facts.feature(f)?.version ?? deployed());
  const of = (f: FeatureId | typeof NEW_FEATURE): ResolvedConfig | undefined => {
    const version = versionFor(f);
    const config = versions.get(version);
    if (config === 'refetching') return undefined;
    let r = resolved.get(config);
    if (r === undefined) {
      r = { config, perms: compilePerms(config), version };
      resolved.set(config, r);
    }
    return r;
  };
  return {
    get deployed() {
      return deployed();
    },
    versionFor,
    of,
    configFor(f) {
      const r = of(f);
      if (r === undefined) throw new AwaitingConfig(versionFor(f));
      return r;
    },
  };
}
