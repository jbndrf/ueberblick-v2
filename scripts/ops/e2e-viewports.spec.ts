import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../testing/plant.mjs';

// The owner's acceptance for every UI port: journeys run at a phone viewport AND a desktop viewport (WP-1017). This
// guard checks the participant app's e2e specs statically. Recognised forms (in `apps/web/e2e/participant/**/*.spec.ts`):
//   - a table or loop of sizes: the quoted names 'phone' and 'desktop' (`['phone', {}]`, `for (const size of [...])`)
//   - explicit device settings: `devices['Desktop Chrome']` (desktop), a `PIXEL` / `devices['Pixel …']` preset or `isMobile: true` (phone), and a
//     `viewport: { width: <n> }` (phone below 768, desktop from 768)
// Component e2e (`apps/web/src/lib/participant/**/e2e/*.e2e.ts`) run at both when the `playwright.config.ts` in their
// e2e directory sets `projects: phoneAndDesktop()` or names a phone and a desktop project. A spec that runs at one size only needs an entry with a reason in
// e2e-viewports.allow.json; an entry that no longer applies (file gone, or now both sizes) fails.
const root = fileURLToPath(new URL('../..', import.meta.url));
const web = join(root, 'apps/web');
const allowFile = join(root, 'scripts/ops/e2e-viewports.allow.json');

const walk = (dir: string, match: (name: string) => boolean): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (isPlanted(p) || e.name === 'node_modules' || e.name.startsWith('.')) return [];
        return e.isDirectory() ? walk(p, match) : match(e.name) ? [p] : [];
      })
    : [];

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\w])\/\/.*$/gm, '$1');

interface Sizes {
  phone: boolean;
  desktop: boolean;
}

/** Which sizes a spec text runs at (comments ignored). */
function sizesOf(source: string): Sizes {
  const text = stripComments(source);
  let phone = /['"`]phone['"`]|\bPIXEL\b|devices\[\s*['"]Pixel|isMobile:\s*true/.test(text);
  let desktop = /['"`]desktop['"`]|devices\[\s*['"]Desktop/.test(text);
  for (const m of text.matchAll(/viewport:\s*\{\s*width:\s*(\d+)/g)) {
    if (Number(m[1]) < 768) phone = true;
    else desktop = true;
  }
  return { phone, desktop };
}

/** A component e2e file runs at both sizes when the config of its e2e directory uses `phoneAndDesktop()`. */
function componentSizes(file: string, read: (p: string) => string | null): Sizes {
  const config = read(join(dirname(file), 'playwright.config.ts'));
  const text = config === null ? '' : stripComments(config);
  const both =
    /projects:\s*phoneAndDesktop\(\)/.test(text) ||
    (/name:\s*['"]phone['"]/.test(text) && /name:\s*['"]desktop['"]/.test(text));
  return { phone: both, desktop: both };
}

const readIfThere = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** Participant e2e files with the sizes they run at, keyed by repo-relative path. */
function participantSpecs(): Map<string, Sizes> {
  const out = new Map<string, Sizes>();
  for (const f of walk(join(web, 'e2e/participant'), (n) => n.endsWith('.spec.ts')))
    out.set(relative(root, f), sizesOf(readFileSync(f, 'utf8')));
  for (const f of walk(join(web, 'src/lib/participant'), (n) => n.endsWith('.e2e.ts')))
    out.set(relative(root, f), componentSizes(f, readIfThere));
  return out;
}

/** Problems: single-size specs without an allowlist entry, and allowlist entries that are stale or lack a reason. */
function violations(specs: Map<string, Sizes>, allow: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, s] of specs) {
    if (s.phone && s.desktop) continue;
    if (!(file in allow)) {
      const only = s.phone ? 'phone' : s.desktop ? 'desktop' : 'neither size';
      problems.push(`${file}: runs at ${only} only; run both sizes or allowlist it with a reason`);
    }
  }
  for (const [file, reason] of Object.entries(allow)) {
    if (reason.trim() === '') problems.push(`${file}: allowlist entry has no reason`);
    const s = specs.get(file);
    if (s === undefined) problems.push(`${file}: stale allowlist entry (no such spec)`);
    else if (s.phone && s.desktop) problems.push(`${file}: stale allowlist entry (now runs at both sizes)`);
  }
  return problems;
}

describe('e2e viewports (WP-1017)', () => {
  it('recognises the forms in use', () => {
    const forms = [
      `for (const [name, use] of [['phone', {}], ['desktop', { viewport: { width: 1280, height: 800 } }]]) {}`,
      `for (const size of ['phone', 'desktop'] as const) { if (size === 'desktop') test.use({ viewport: { width: 1280, height: 800 } }); }`,
      `test.describe('d', () => { test.use({ viewport: { width: 390, height: 844 } }); });\ntest.describe('e', () => { test.use({ viewport: { width: 1280, height: 800 } }); });`,
      `const sizes = [['desktop', {}], ['phone', PIXEL]];`,
    ];
    for (const f of forms) expect(sizesOf(f), f).toEqual({ phone: true, desktop: true });
  });

  it('a single-size text fails, comments do not count', () => {
    const one = sizesOf("test.use({ viewport: { width: 1280, height: 800 } });\n// on a 'phone' too\n");
    expect(one).toEqual({ phone: false, desktop: true });
    expect(violations(new Map([['a.spec.ts', one]]), {})).toHaveLength(1);
    expect(sizesOf('test("x", () => {});')).toEqual({ phone: false, desktop: false });
  });

  it('an allowlisted single-size spec passes; a stale or reasonless entry fails', () => {
    const specs = new Map<string, Sizes>([
      ['one.spec.ts', { phone: false, desktop: true }],
      ['two.spec.ts', { phone: true, desktop: true }],
    ]);
    expect(violations(specs, { 'one.spec.ts': 'no phone variant in v3' })).toEqual([]);
    expect(violations(specs, { 'one.spec.ts': '  ' })).toHaveLength(1);
    expect(violations(specs, { 'one.spec.ts': 'r', 'two.spec.ts': 'r' })).toHaveLength(1);
    expect(violations(specs, { 'one.spec.ts': 'r', 'gone.spec.ts': 'r' })).toHaveLength(1);
  });

  it('devices presets count', () => {
    expect(sizesOf("test.use({ ...devices['Desktop Chrome'] });")).toEqual({ phone: false, desktop: true });
    expect(sizesOf("test.use({ ...devices['Pixel 7'] });")).toEqual({ phone: true, desktop: false });
  });

  it('a component e2e counts as both sizes only with phoneAndDesktop() in its config', () => {
    const cfg = (t: string) => () => t;
    expect(componentSizes('/x/a.e2e.ts', cfg('projects: phoneAndDesktop(),'))).toEqual({
      phone: true,
      desktop: true,
    });
    const named = "projects: [{ name: 'phone', use: {} }, { name: 'desktop', use: {} }]";
    expect(componentSizes('/x/a.e2e.ts', cfg(named)).desktop).toBe(true);
    expect(componentSizes('/x/a.e2e.ts', cfg('// projects: phoneAndDesktop()')).phone).toBe(false);
    expect(componentSizes('/x/a.e2e.ts', () => null).phone).toBe(false);
  });

  it('every participant e2e runs at phone and desktop, or is allowlisted with a reason', () => {
    const allow = JSON.parse(readFileSync(allowFile, 'utf8')) as Record<string, string>;
    expect(violations(participantSpecs(), allow)).toEqual([]);
  });
});
