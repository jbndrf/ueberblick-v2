// WP-952: the Docker runtime stage gets every external runtime dependency of apps/web, derived, not hand-picked.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { externalRuntimeDeps, missingRuntimeDeps, pinnedRuntimeDeps } from './runtime-deps.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'runtime-deps-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('docker runtime dependencies', () => {
  it('derives the external dependencies of apps/web without workspace packages', () => {
    const deps = externalRuntimeDeps();
    expect(Object.keys(deps)).toEqual(expect.arrayContaining(['better-sqlite3', 'sharp']));
    expect(Object.keys(deps).filter((n) => n.startsWith('@ueberblick/'))).toEqual([]);
    expect(Object.values(pinnedRuntimeDeps()).every((v) => /^\d+\.\d+\.\d+/.test(v))).toBe(true);
  });

  it('the real Dockerfile misses none of them', () => {
    expect(missingRuntimeDeps(dockerfile, externalRuntimeDeps())).toEqual([]);
  });

  it('a planted extra dependency fails a hand-picked Dockerfile', () => {
    const web = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8'));
    web.dependencies['planted-native-dep'] = '^1.0.0';
    mkdirSync(join(tmp, 'web'), { recursive: true });
    writeFileSync(join(tmp, 'web/package.json'), JSON.stringify(web));
    const deps = externalRuntimeDeps(root, join(tmp, 'web/package.json'));
    expect(Object.keys(deps)).toContain('planted-native-dep');
    const handPicked =
      'COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3\n' +
      'COPY --from=build /app/node_modules/sharp ./node_modules/sharp\n';
    expect(missingRuntimeDeps(handPicked, deps)).toContain('planted-native-dep');
  });

  it('a Dockerfile that also hand-copies modules is not accepted as derived', () => {
    const mixed = `${dockerfile}\nCOPY --from=build /app/node_modules/sharp ./node_modules/sharp\n`;
    expect(missingRuntimeDeps(mixed, { 'planted-native-dep': '1.0.0' })).toEqual(['planted-native-dep']);
  });
});
