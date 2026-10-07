// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withPlants } from '../../../../scripts/testing/plant.mjs';

const repo = join(__dirname, '../../../..');

// `npm run boundaries` enforces `no-testing-helpers-in-prod`; this plants files to prove it covers the simulation harness.
describe('the simulation harness stays out of production code', () => {
  it('a production file importing @ueberblick/core/testing fails the boundaries check; a testkit passes', () => {
    const prod = 'packages/server/src/store/prod.planted.ts';
    const kit = 'packages/server/src/store/kit.planted.testkit.ts';
    const body =
      "import { simServerFactory } from '@ueberblick/core/testing';\nexport const x = simServerFactory;\n";
    const cruise = (file: string) =>
      spawnSync('npx', ['depcruise', file, '--config', '.dependency-cruiser.cjs', '--output-type', 'err'], {
        cwd: repo,
        encoding: 'utf8',
      });
    withPlants(repo, { [prod]: body, [kit]: body }, () => {
      const bad = cruise(prod);
      expect(bad.status).not.toBe(0);
      expect(bad.stdout + bad.stderr).toContain('no-testing-helpers-in-prod');
      expect(cruise(kit).status).toBe(0);
    });
  }, 120_000);
});
