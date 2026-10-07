/** The commands of `npm run migrate` on the synthetic fixtures. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, it } from 'vitest';
import { runCli } from './cli-run';

const fixture = (dir: string, name: string): string =>
  new URL(`../../../fixtures/v3-synthetic/${dir}/${name}.yaml`, import.meta.url).pathname;

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('migrate cli', () => {
  it('dry-run passes', async () => {
    const r = await cli('dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('dry run passed');
  });

  it('convert writes template, overlay, report and mapping', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
    const r = await cli('convert', fixture('config', 'baumkontrolle'), '--out', dir);
    expect(r.code).toBe(0);
    expect(r.out).toContain('personal data: types.baum.properties.kontakt');
    expect(readFileSync(join(dir, 'template.yaml'), 'utf8')).toContain('schema: ueberblick/1');
    expect(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'))).toHaveProperty('items');
  });

  it('diffcheck reports and exits 0 without unexplained differences', async () => {
    const r = await cli('diffcheck', fixture('config', 'baumkontrolle'), fixture('runs', 'baumkontrolle'));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/unexplained 0/);
  });

  it('import fills the roster from the v3 users', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
    const data = parse(readFileSync(fixture('data', 'baumkontrolle'), 'utf8')) as object;
    const file = join(dir, 'data.yaml');
    writeFileSync(file, stringify({ ...data, users: [{ id: 'anna', roles: ['verwaltung'] }] }));
    const r = await cli('import', fixture('config', 'baumkontrolle'), file, '--dir', dir);
    expect(r.code).toBe(0);
    const { openProjectDb, participantRolesOf } = await import('@ueberblick/server');
    const db = openProjectDb(dir, 'migrated');
    try {
      expect(participantRolesOf(db, 'anna')).toEqual(['verwaltung']);
    } finally {
      db.close();
    }
  });

  it('import writes the project database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
    const r = await cli(
      'import',
      fixture('config', 'baumkontrolle'),
      fixture('data', 'baumkontrolle'),
      '--dir',
      dir,
    );
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/runs accepted/);
  });

  it('exits 1 when the config cannot be converted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
    const bad = join(dir, 'bad.yaml');
    writeFileSync(bad, 'format: 99\n');
    const r = await cli('convert', bad, '--out', join(dir, 'out'));
    expect(r.code).toBe(1);
    expect(r.err).toContain('unknown v3 export format');
  });

  it('exits 1 when diffcheck finds an unexplained difference', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-'));
    const runs = parse(readFileSync(fixture('runs', 'baumkontrolle'), 'utf8')) as {
      recorded: { outcome: string; known?: unknown };
    }[];
    for (const r of runs) {
      delete r.recorded.known;
      r.recorded.outcome = r.recorded.outcome === 'accepted' ? 'refused' : 'accepted';
    }
    const file = join(dir, 'runs.yaml');
    writeFileSync(file, stringify(runs));
    const r = await cli('diffcheck', fixture('config', 'baumkontrolle'), file);
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/unexplained 0/);
  });

  it('shows the usage on wrong use', async () => {
    const r = await cli('convert');
    expect(r.code).toBe(2);
    expect(r.err).toContain('usage');
  });
});
