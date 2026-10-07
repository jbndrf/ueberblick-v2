/**
 * Per-feature config resolution (A-029 §2): `envAt` gives the view of one plan call that reads a feature's version.
 * The views share the overlay, the trace and the quota counters; only `config`, `perms`, `inputs` and `version` differ.
 */
import type { FeatureId } from '../model';
import { NEW_FEATURE } from './contract';
import { inputValues, type Env } from './scope';

/**
 * The env for `id`: its pinned (or floating) version. No id, an id that does not exist yet, or one created by this
 * batch resolves `NEW_FEATURE`. Cached per key, so the resolver is called once per touched feature per plan call.
 */
export function envAt(env: Env, id: FeatureId | undefined): Env {
  const key: string =
    id === undefined || env.fresh.has(id) || env.overlay.feature(id) === undefined ? NEW_FEATURE : id;
  const hit = env.views.get(key);
  if (hit !== undefined) return hit;
  const rc = env.configFor(key === NEW_FEATURE ? NEW_FEATURE : (key as FeatureId));
  const view: Env = {
    ...env,
    config: rc.config,
    perms: rc.perms,
    inputs: inputValues(rc.config),
    version: rc.version,
  };
  env.views.set(key, view);
  return view;
}
