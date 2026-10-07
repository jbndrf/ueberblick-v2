/** Reads the three synthetic v3 files of a fixture (`fixtures/v3-synthetic/{config,runs,data}/<name>.yaml`). */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { DryRunInput } from './dry-run';

const read = (dir: string, name: string): unknown =>
  parse(
    readFileSync(new URL(`../../../../fixtures/v3-synthetic/${dir}/${name}.yaml`, import.meta.url), 'utf8'),
  );

export function dryRunFixture(name: string): DryRunInput {
  return { config: read('config', name), runs: read('runs', name), data: read('data', name) };
}
