/**
 * The classification a participant sees (WP-1075): a type whose classifying property the actor may not read is
 * unclassified for them, so the marker, the per-value switches and rows and the cluster counts fall back to the
 * type's own `marker`. The read right is `perms.forType(t).readable(...)`, the very call the sync strips by (R1);
 * the config is only rewritten here, so every consumer of `config.file.types` funnels through one decision.
 * Only an explicit `classify` is dropped: the stage property of a process stays the stage.
 */
import type { CompiledConfig } from '../schema/compile/contract';
import type { Actor } from '../model';
import { compilePerms } from './compile';
import type { Perms } from './contract';

const permsOfConfig = new WeakMap<CompiledConfig, Perms>();
const results = new WeakMap<CompiledConfig, Map<string, CompiledConfig>>();

/** `config` with `classify` removed from every type whose classifying property the actor may not read; the same object when none. */
export function classifiedFor(config: CompiledConfig, actor: Actor): CompiledConfig {
  const types = config.file.types;
  if (types === undefined) return config;
  const roles = [...actor.roles].sort().join(',');
  const kept = results.get(config)?.get(roles);
  if (kept !== undefined) return kept;
  let perms = permsOfConfig.get(config);
  if (perms === undefined) {
    perms = compilePerms(config);
    permsOfConfig.set(config, perms);
  }
  const subjects = perms.subjects(actor);
  let changed = false;
  const next = Object.fromEntries(
    Object.entries(types).map(([key, type]) => {
      const by = type.classify?.property;
      if (by === undefined) return [key, type];
      const readable = perms?.forType(key as never)?.readable(subjects);
      if (readable === undefined || readable.has(by)) return [key, type];
      changed = true;
      return [key, { ...type, classify: undefined }];
    }),
  );
  const out = changed ? { ...config, file: { ...config.file, types: next } } : config;
  const byRoles = results.get(config) ?? new Map<string, CompiledConfig>();
  byRoles.set(roles, out);
  results.set(config, byRoles);
  return out;
}
