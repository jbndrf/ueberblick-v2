// WP-212: participant code never imports the builder. Plants files and runs the real depcruise rule.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { withPlants } from '../../../../scripts/testing/plant.mjs';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../../..');

const bare = "import { openProject } from '@ueberblick/builder';\nexport const o = openProject;\n";
const violating: Record<string, string> = {
  'packages/ui/src/isolation-bare.planted.ts': bare,
  'packages/ui/src/isolation-relative.planted.ts':
    "import * as doc from '../../builder/src/doc/index';\nexport const d = doc;\n",
  'packages/client/src/isolation-deep.planted.ts':
    "import * as doc from '@ueberblick/builder/src/doc';\nexport const d = doc;\n",
  'packages/client/src/isolation-dynamic.planted.ts':
    "export const load = () => import('@ueberblick/builder');\n",
  'apps/web/src/routes/isolation-route.planted/participant.ts': bare,
  'apps/web/src/lib/isolation-lib.planted.ts': bare,
};
const allowed: Record<string, string> = {
  'apps/web/src/routes/(builder)/isolation-ok.planted.ts': bare,
  'packages/builder/src/shell/isolation-own.planted.ts': "export { openProject } from '../doc';\n",
};

const all = { ...violating, ...allowed };

// WP-152: the plants exist for this one depcruise call only (WP-143), and their paths are unique to this spec.
const run = withPlants(root, all, () =>
  spawnSync('npx', ['depcruise', ...Object.keys(all), '--config', '.dependency-cruiser.cjs'], {
    cwd: root,
    encoding: 'utf8',
  }),
);

describe('the builder is not importable from participant code', () => {
  const r = run;
  const out = `${r.stdout}${r.stderr}`;

  it('fails the check', () => {
    expect(r.status).not.toBe(0);
    expect(out).toContain('participant-no-builder');
  });

  it.each(Object.keys(violating))('reports %s', (file) => {
    const line = out.split('\n').find((l) => l.includes(file) && l.includes('participant-no-builder'));
    expect(line, out).toBeDefined();
  });

  it.each(Object.keys(allowed))('does not report %s', (file) => {
    const line = out.split('\n').find((l) => l.includes(file) && l.includes('participant-no-builder'));
    expect(line).toBeUndefined();
  });
}, 180_000);
