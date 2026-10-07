import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOwnPackages, ensureOwnPackages } from './own-packages.mjs';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const writeJson = (f: string, v: unknown) => writeFileSync(f, JSON.stringify(v));

/** parent/ has node_modules/@ueberblick/{core,ui} linking to parent's packages; parent/co is the checkout. */
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'own-pkgs-'));
  dirs.push(parent);
  const pkgs = (root: string) => {
    mkdirSync(join(root, 'packages', 'core'), { recursive: true });
    mkdirSync(join(root, 'packages', 'tools', 'map'), { recursive: true });
    writeJson(join(root, 'package.json'), { workspaces: ['packages/*', 'packages/tools/*'] });
    writeJson(join(root, 'packages', 'core', 'package.json'), { name: '@ueberblick/core' });
    writeJson(join(root, 'packages', 'tools', 'map', 'package.json'), { name: '@ueberblick/tool-map' });
  };
  const link = (root: string) => {
    mkdirSync(join(root, 'node_modules', '@ueberblick'), { recursive: true });
    symlinkSync('../../packages/core', join(root, 'node_modules', '@ueberblick', 'core'));
    symlinkSync('../../packages/tools/map', join(root, 'node_modules', '@ueberblick', 'tool-map'));
  };
  pkgs(parent);
  link(parent);
  const co = join(parent, 'co');
  mkdirSync(co);
  pkgs(co);
  return { parent, co, link };
}

describe('own packages guard', () => {
  it('reports every workspace package a checkout without links would take from its parent', () => {
    const { co } = fixture();
    const bad = checkOwnPackages(co);
    expect(bad.map((b: { name: string }) => b.name).sort()).toEqual([
      '@ueberblick/core',
      '@ueberblick/tool-map',
    ]);
  });

  it('reports a link that points outside the checkout', () => {
    const { co, parent } = fixture();
    mkdirSync(join(co, 'node_modules', '@ueberblick'), { recursive: true });
    symlinkSync(join(parent, 'packages', 'core'), join(co, 'node_modules', '@ueberblick', 'core'));
    symlinkSync('../../packages/tools/map', join(co, 'node_modules', '@ueberblick', 'tool-map'));
    const bad = checkOwnPackages(co);
    expect(bad).toHaveLength(1);
    expect(bad[0]?.name).toBe('@ueberblick/core');
    expect(bad[0]?.resolved).toContain(parent);
  });

  it('is a no-op for a good checkout', () => {
    const { co, link } = fixture();
    link(co);
    let called = 0;
    const r = ensureOwnPackages(co, { link: () => void called++ });
    expect(called).toBe(0);
    expect(r).toMatchObject({ ok: true, relinked: false });
  });

  it('repairs with the linker, once, and says so', () => {
    const { co, link } = fixture();
    let called = 0;
    const r = ensureOwnPackages(co, {
      link: () => {
        called++;
        link(co);
      },
    });
    expect(called).toBe(1);
    expect(r).toMatchObject({ ok: true, relinked: true });
    expect(r.message).toBe(
      'own packages: relinked (node_modules resolved @ueberblick/core, @ueberblick/tool-map outside this checkout)',
    );
  });

  it('fails with the instruction when the repair does not fix it', () => {
    const { co } = fixture();
    const r = ensureOwnPackages(co, { link: () => {} });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(
      /^own packages: @ueberblick\/\S+ resolves to .*, outside .*; run rm -rf node_modules && npm run deps:install$/,
    );
  });

  it('fails (not throws) when the linker throws', () => {
    const { co } = fixture();
    const r = ensureOwnPackages(co, {
      link: () => {
        throw new Error('boom');
      },
    });
    expect(r.ok).toBe(false);
  });
});
