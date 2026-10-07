// WP-949: the pieces of `npm run dev` that are fast: argument parsing, the seed-once rule, and the TOTP option of
// `seedControl` (the demo and dev seeds turn it off; the e2e specs keep the default).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openControlDb } from '@ueberblick/server';
import { afterAll, describe, expect, it } from 'vitest';
import { seedControl } from '../../apps/web/e2e/seed';
// @ts-expect-error plain .mjs without types
import { ensureSeeded, MARKER, parseArgs } from './dev.mjs';

const root = mkdtempSync(join(tmpdir(), 'ub-dev-seed-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
/** Its own directory per call, so a repeated execution never meets the leftovers of the first. */
const fresh = (name: string): string => mkdtempSync(join(root, `${name}-`));
const mfaOf = (dir: string): string | null => {
  const control = openControlDb(`${dir}/control.db`);
  try {
    return control.prepare<{ mfa: string | null }>('SELECT mfa FROM accounts LIMIT 1').get()?.mfa ?? null;
  } finally {
    control.close();
  }
};

describe('dev arguments', () => {
  it('defaults to https on 5173 with ./.dev-data; --http, --reset, DATA_DIR and DEV_RESET apply', () => {
    const d = parseArgs([], {});
    expect(d).toMatchObject({ port: 5173, host: '0.0.0.0', reset: false, http: false });
    expect(d.dir.endsWith('/.dev-data')).toBe(true);
    expect(parseArgs(['--http', '--reset', '--port', '6000', '--dir', '/x'], {})).toMatchObject({
      http: true,
      reset: true,
      port: 6000,
      dir: '/x',
    });
    expect(parseArgs([], { DATA_DIR: '/y', DEV_RESET: '1', DEV_HTTP: 'true' })).toMatchObject({
      dir: '/y',
      reset: true,
      http: true,
    });
    expect(() => parseArgs(['--nope'], {})).toThrow('unknown flag');
  });
});

// These seed a real control.db (password hash, TOTP): seconds under load, so not the 5 s default.
const SEED_TIMEOUT = { timeout: 30_000 };

describe('seed once', SEED_TIMEOUT, () => {
  const noServer = (): never => {
    throw new Error('the server must not start');
  };

  it('does not seed a dir that carries the marker, and reports the stored sign-in', async () => {
    const dir = fresh('seeded');
    writeFileSync(join(dir, MARKER), `${JSON.stringify({ email: 'a@b.c', password: 'pw' })}\n`);
    expect(await ensureSeeded(dir, { start: noServer })).toEqual({
      email: 'a@b.c',
      password: 'pw',
      seeded: false,
    });
  });

  it('refuses a non-empty dir without the marker', async () => {
    const dir = fresh('foreign');
    writeFileSync(join(dir, 'something'), 'x');
    await expect(ensureSeeded(dir, { start: noServer })).rejects.toThrow('not a seeded dev data dir');
  });

  it('--reset wipes the dir, then seeds (the seed runs control.db first, so a control.db appears)', async () => {
    const dir = fresh('reset');
    writeFileSync(join(dir, MARKER), '{"email":"a","password":"b"}\n');
    await expect(ensureSeeded(dir, { reset: true, start: noServer })).rejects.toThrow('must not start');
    expect(() => readFileSync(join(dir, MARKER))).toThrow();
    expect(mfaOf(dir)).toBeNull();
  });
});

describe('seedControl TOTP option', SEED_TIMEOUT, () => {
  it('enrols TOTP by default (the e2e specs rely on it)', async () => {
    const dir = fresh('totp-on');
    const seeded = await seedControl(dir, ['alpha']);
    expect(JSON.parse(mfaOf(dir) ?? 'null')).toMatchObject({ confirmed: true });
    expect(seeded.totp()).toMatch(/^\d{6}$/);
  });

  it('{ totp: false } leaves the admin without TOTP: e-mail and password only', async () => {
    const dir = fresh('totp-off');
    const seeded = await seedControl(dir, ['alpha'], { totp: false });
    expect(mfaOf(dir)).toBeNull();
    expect(() => seeded.totp()).toThrow('no TOTP');
  });
});
