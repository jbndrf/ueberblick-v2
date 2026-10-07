import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain .mjs runner without declarations
import { PORT_VARS, assignRun, freePorts } from './run.mjs';

type Env = Record<string, string>;
interface Var {
  port: string;
  dir: string;
}
const assign = assignRun as (
  suites: readonly { name: string }[],
  base: string,
  ports: number[],
) => { suite: { name: string }; env: Env }[];
const ports = freePorts as (n: number) => Promise<number[]>;
const vars = PORT_VARS as readonly Var[];
const suites = [{ name: 'a' }, { name: 'b' }];
const need = vars.length * suites.length;

const base = mkdtempSync(join(tmpdir(), 'e2e-parallel-spec-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('run.mjs assignment', () => {
  it('gives two runs distinct ports and distinct data dirs, and hands them to each suite as env', async () => {
    const one = assign(suites, join(base, 'one'), await ports(need));
    const two = assign(suites, join(base, 'two'), await ports(need));
    const cells = [...one, ...two].flatMap((a) => vars.map((v) => [a.env[v.port], a.env[v.dir]] as const));
    expect(cells.every(([port]) => /^\d+$/.test(port ?? ''))).toBe(true);
    const dirs = cells.map(([, dir]) => dir);
    expect(new Set(dirs).size).toBe(dirs.length);
    expect(dirs.every((d) => d?.startsWith(base))).toBe(true);
    // within one run every port is distinct, so no two servers of the run collide
    expect(new Set(one.flatMap((a) => vars.map((v) => a.env[v.port]))).size).toBe(need);
  });
  it('freePorts returns distinct ports', async () => {
    const got = await ports(8);
    expect(new Set(got).size).toBe(8);
  });
});

describe('playwright configs resolve port and data dir', () => {
  const keys = vars.flatMap((v) => [v.port, v.dir]);
  async function load(path: string, env: Env) {
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) Reflect.deleteProperty(process.env, k);
    Object.assign(process.env, env);
    // a config wipes its data dir in the main process: pretend to be a worker so the fallback dir of a real run stays
    process.env['TEST_WORKER_INDEX'] = '0';
    try {
      vi.resetModules();
      return (await import(/* @vite-ignore */ path)) as Record<string, unknown>;
    } finally {
      delete process.env['TEST_WORKER_INDEX'];
      for (const k of keys) {
        if (saved[k] === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = saved[k];
      }
    }
  }
  const web = '../../apps/web/playwright.config';
  const a11y = '../../e2e/a11y/playwright.config';
  const part = '../../e2e/participant/playwright.config';
  const journeys = '../../e2e/journeys/playwright.config';

  it('uses the env when set', async () => {
    const env: Env = {};
    vars.forEach((v, i) => {
      env[v.port] = String(5100 + i);
      env[v.dir] = `/x/${i}`;
    });
    const w = await load(web, env);
    const a = await load(a11y, env);
    const p = await load(part, env);
    const jr = await load(journeys, env);
    expect([w['E2E_PORT'], w['E2E_DATA_DIR']]).toEqual([5100, '/x/0']);
    expect([a['A11Y_PORT'], a['A11Y_DATA_DIR']]).toEqual([5101, '/x/1']);
    expect([p['PARTICIPANT_PORT'], p['PARTICIPANT_DATA_DIR']]).toEqual([5102, '/x/2']);
    expect([jr['JOURNEYS_PORT'], jr['JOURNEYS_DATA_DIR']]).toEqual([5103, '/x/3']);
  });
  it('falls back to the constants when unset', async () => {
    const w = await load(web, {});
    const a = await load(a11y, {});
    const p = await load(part, {});
    const jr = await load(journeys, {});
    expect([w['E2E_PORT'], a['A11Y_PORT'], p['PARTICIPANT_PORT'], jr['JOURNEYS_PORT']]).toEqual([
      4173, 4174, 4175, 4176,
    ]);
    expect(jr['JOURNEYS_DATA_DIR']).toBe(join(tmpdir(), 'ueberblick-e2e-journeys'));
    expect(w['E2E_DATA_DIR']).toBe(join(tmpdir(), 'ueberblick-e2e-flow'));
    expect(a['A11Y_DATA_DIR']).toBe(join(tmpdir(), 'ueberblick-e2e-a11y'));
    expect(p['PARTICIPANT_DATA_DIR']).toBe(join(tmpdir(), 'ueberblick-e2e-participant'));
  });
});
