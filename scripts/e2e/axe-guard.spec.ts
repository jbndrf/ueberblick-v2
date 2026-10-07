// WP-1042: e2e specs scan with e2e/a11y/axe.ts only (it waits for animations); none injects axe-core itself (R1).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../testing/plant.mjs';

const ROOT = join(__dirname, '..', '..');
const HELPER = 'e2e/a11y/axe.ts';
const SELF = /(axe-core|window\.axe|globalThis\.axe)/;

const isE2eFile = (r: string): boolean =>
  r !== HELPER &&
  (/\.e2e\.ts$/.test(r) || /^apps\/web\/e2e\/.+\.ts$/.test(r) || /^e2e\/.+\.ts$/.test(r)) &&
  !/\/axe-helper\.spec\.ts$/.test(r);

/** The e2e files under `root` that reference axe-core or the axe global themselves. */
export function offenders(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build' || isPlanted(r)) continue;
      if (e.isDirectory()) walk(r);
      else if (isE2eFile(r) && SELF.test(readFileSync(join(root, r), 'utf8'))) out.push(r);
    }
  };
  for (const top of ['apps', 'packages', 'e2e']) walk(top);
  return out.sort();
}

describe('axe guard', () => {
  it('no e2e file injects axe-core or calls window.axe outside the helper', () => {
    expect(offenders(ROOT)).toEqual([]);
  });

  it('fails a planted offender, and ignores the helper and unit specs', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'axe-guard-'));
    try {
      const put = (rel: string, src: string): void => {
        mkdirSync(dirname(join(tmp, rel)), { recursive: true });
        writeFileSync(join(tmp, rel), src);
      };
      put('packages/x/src/e2e/bad.e2e.ts', "await page.addScriptTag({ path: require.resolve('axe-core') });");
      put('apps/web/e2e/bad.spec.ts', 'await window.axe.run(document);');
      put('e2e/a11y/axe.ts', "const p = require.resolve('axe-core/axe.min.js');");
      put('packages/x/src/y.ui.spec.ts', "import axe from 'axe-core';");
      put('packages/x/src/e2e/good.e2e.ts', "import { axeViolations } from '../../../../e2e/a11y/axe';");
      expect(offenders(tmp)).toEqual(['apps/web/e2e/bad.spec.ts', 'packages/x/src/e2e/bad.e2e.ts']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
