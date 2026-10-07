import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH } from '../auth/params';
import { runCli } from './cli-run';

const dir = mkdtempSync(join(tmpdir(), 'ueb-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function cli(env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    ['create-admin', 'chef@example.org'],
    { DATA_DIR: dir, ...env },
    {
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    },
  );
  return { code, out, err };
}

describe('admin CLI: create-admin', () => {
  it('names the actual minimum password length when UEBERBLICK_ADMIN_PASSWORD is missing', async () => {
    const { code, err } = await cli();
    expect(code).toBe(2);
    expect(err).toEqual([`Set UEBERBLICK_ADMIN_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters).`]);
  });
});

describe('admin CLI: publish-template with compile problems (WP-836)', () => {
  it('prints every compile problem as text, never [object Object]', async () => {
    const src = readFileSync(
      fileURLToPath(
        new URL('../../../../fixtures/golden/templates/baumkataster/1.0.0.yaml', import.meta.url),
      ),
      'utf8',
    ).replace('start: erfasst, end: [erledigt]', 'start: nope_a, end: [nope_b]');
    const file = join(dir, 'broken.yaml');
    writeFileSync(file, embedGoldenSource(src));
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(
      ['publish-template', file],
      { DATA_DIR: dir },
      { out: (l) => out.push(l), err: (l) => err.push(l) },
    );
    expect(code).toBe(1);
    const text = err.join('\n');
    expect(text).not.toContain('[object Object]');
    expect(text).toContain('nope_a');
    expect(text).toContain('nope_b');
  });
});
