// @vitest-environment jsdom
// WP-586: every UI string lives in a Paraglide catalogue, one per package. The participant app's is
// `apps/web/messages`; each tool package carries its own. No `messages.ts` string table may come back.
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { isSorted } from '../../../../../scripts/messages-sort.mjs';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';
import NoticeBar from './NoticeBar.svelte';
import { message } from './messages';
import { localeOf } from './locale-tag';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const TOOLS = ['draw', 'measure', 'photo', 'search'];

/** Files under `dir` that hold a string table (`const EN = {…}`, `const de = {…}`): the old per-package mechanism. */
function findTables(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'paraglide' || name.startsWith('.') || isPlanted(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) findTables(path, acc);
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.spec.ts')) {
      const src = readFileSync(path, 'utf8');
      if (/^(?:export )?const (?:EN|DE|en|de|ISSUE_EN|ISSUE_DE)\b[^=\n]*= \{/m.test(src)) acc.push(path);
    }
  }
  return acc;
}

const json = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(REPO, file), 'utf8')) as Record<string, string>;
const CATALOGUES = [
  { name: 'participant app', dir: 'apps/web/messages' },
  ...TOOLS.map((t) => ({ name: `tool ${t}`, dir: `packages/tools/${t}/messages` })),
];
const tmp: string[] = [];
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
  document.body.innerHTML = '';
});

describe('no messages.ts string table remains', () => {
  it('the tools and the participant app hold none', () => {
    const roots = [...TOOLS.map((t) => `packages/tools/${t}/src`), 'apps/web/src'];
    expect(roots.flatMap((r) => findTables(join(REPO, r)))).toEqual([]);
  });

  it('the guard finds a table in a scratch tree, and ignores plants', () => {
    const root = mkdtempSync(join(tmpdir(), 'ub-tables-'));
    tmp.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'messages.ts'), "const EN = {\n  a: 'A',\n} as const;\n");
    writeFileSync(join(root, 'src', 'x.planted.ts'), "const DE = {\n  a: 'A',\n};\n");
    expect(findTables(root).map((p) => p.slice(root.length))).toEqual(['/src/messages.ts']);
  });
});

describe.each(CATALOGUES)('catalogue of the $name', ({ dir }) => {
  it('has the same keys in de and en', () => {
    expect(Object.keys(json(`${dir}/de.json`)).sort()).toEqual(Object.keys(json(`${dir}/en.json`)).sort());
  });

  it.each(['de', 'en'])('%s is sorted (run npm run messages:sort)', (locale) => {
    expect(isSorted(readFileSync(join(REPO, dir, `${locale}.json`), 'utf8'))).toBe(true);
  });
});

describe('participant app renders from apps/web/messages', () => {
  it.each(['de', 'en'] as const)('message() gives the %s text with values filled in', (locale) => {
    const cat = json(`apps/web/messages/${locale}.json`);
    expect(message(locale, 'login_title')).toBe(cat['participant_login_title']);
    expect(message(locale, 'me_unsent', { count: 3 })).toBe(
      (cat['participant_me_unsent'] ?? '').replace('{count}', '3'),
    );
  });

  it.each(['de', 'en'] as const)('a component shows the %s text', (locale) => {
    render(NoticeBar, { notice: { kind: 'auth_expired', text: 'x', signIn: true }, locale });
    const cat = json(`apps/web/messages/${locale}.json`);
    expect(screen.getByRole('link', { name: cat['participant_notice_sign_in'] ?? '' })).toBeTruthy();
  });

  it('German is the default, English only for en tags', () => {
    expect(localeOf('en-GB')).toBe('en');
    expect(localeOf('fr')).toBe('de');
  });
});
