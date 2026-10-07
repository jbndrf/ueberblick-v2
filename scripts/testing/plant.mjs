// The one plant convention (WP-138, R1). A "plant" is a temporary source file a guardrail spec writes so that
// a real tool (depcruise, eslint, tsc) can be shown to reject it. Any path segment containing `.planted`
// marks a plant: `x.planted.ts`, `x.planted.testkit.ts`, `dir.planted/`. glossary-lint skips them (they race
// with its scan and may contain banned terms on purpose). Not gitignored: svelte-check honours .gitignore and must see them.
// .prettierignore and eslint's global ignores skip them (they race with whole-repo checks); a spec that formats
// a plant passes --ignore-path /dev/null, one that lints a plant passes --no-ignore (WP-1022).
// The root, ui, builder, web and bench tsconfigs exclude `**/*.planted*` and `**/*.planted/**` too, so a whole-repo
// typecheck beside plant-writing specs cannot see a plant that is a type error on purpose; a spec that typechecks a
// plant writes its own tsconfig with an explicit `include` of the plant and `exclude: []` (WP-1022).
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const PLANT_MARK = '.planted';

/** True when any segment of the path is a plant name. */
export function isPlanted(path) {
  return path.split(/[\\/]/).some((seg) => seg.includes(PLANT_MARK));
}

/**
 * Writes plants under `root` (paths relative to it) and returns `remove()`. Creates missing directories,
 * and removes the files and the directories it created. Refuses a name that is not a plant name.
 */
export function plant(root, files) {
  const created = [];
  const written = [];
  function remove() {
    for (const f of written) rmSync(f, { force: true });
    for (const d of created) rmSync(d, { recursive: true, force: true });
  }
  try {
    for (const [rel, src] of Object.entries(files)) {
      if (!isPlanted(rel))
        throw new Error(`plant: "${rel}" does not follow the plant convention (${PLANT_MARK})`);
      const abs = join(root, rel);
      const missing = [];
      for (let d = dirname(abs); d !== root && d.startsWith(root) && !existsSync(d); d = dirname(d))
        missing.push(d);
      mkdirSync(dirname(abs), { recursive: true });
      created.push(...missing);
      writeFileSync(abs, src);
      written.push(abs);
    }
  } catch (e) {
    remove();
    throw e;
  }
  return { remove, paths: written.map((p) => relative(root, p).split(sep).join('/')) };
}

/** Plants, runs `fn`, and always removes the plants. */
export function withPlants(root, files, fn) {
  const p = plant(root, files);
  try {
    return fn();
  } finally {
    p.remove();
  }
}
