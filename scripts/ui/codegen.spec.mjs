// WP-902: codegen golden tests. steps.json in, Playwright spec out.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { generateSpec, locatorExpr, validateExpect } from './codegen.mjs';

const APP = 'http://127.0.0.1:41234';
const at = (n, cmd, locator, args = [], url = `${APP}/x`) => ({ n, cmd, locator, args, url });

const doc = {
  journey: 'demo',
  title: 'Demo',
  viewport: { width: 360, height: 800 },
  steps: [
    at(1, 'seed', null, ['musterstadt-baeume'], 'about:blank'),
    at(2, 'open', null, [`${APP}/builder/musterstadtbaeume`]),
    at(3, 'click', { role: 'button', name: 'Outline' }, []),
    at(4, 'click', { role: 'link', name: "Tree's type", nth: 1 }, []),
    at(5, 'fill', { testid: 'name-input' }, ['Oak']),
    at(6, 'fill', { label: 'Password' }, ['a\\b']),
    at(7, 'select', { role: 'combobox', name: 'Offered on' }, ['tree']),
    at(8, 'press', null, ['Enter']),
    at(9, 'wait', null, ['Saved']),
    at(10, 'wait', { role: 'status', name: 'Save status' }, []),
  ],
  expectations: [
    { after: 2, expect: { role: 'navigation', name: 'Path', visible: true } },
    { after: 4, expect: { role: 'heading', name: 'Tree', text: 'Tree' } },
    { after: 4, expect: { role: 'listitem', name: 'Row', count: 3 } },
    { after: 4, expect: { url: '/builder/musterstadtbaeume/tree' } },
    { after: 9, expect: { text: 'Saved' } },
    { after: 10, expect: { testid: 'spinner', visible: false } },
    { after: 10, expect: { label: 'Name', visible: true } },
  ],
};

describe('generateSpec (golden)', () => {
  const { spec, expectations } = generateSpec(doc);

  it('emits role+name, testid and label locators, nth, and every step kind', () => {
    expect(spec).toContain("app = await seedApp(page, 'musterstadt-baeume');");
    expect(spec).toContain("await page.goto(url('/builder/musterstadtbaeume'));");
    expect(spec).toContain("await page.getByRole('button', { name: 'Outline', exact: true }).click();");
    expect(spec).toContain(
      "await page.getByRole('link', { name: 'Tree\\'s type', exact: true }).nth(1).click();",
    );
    expect(spec).toContain("await page.getByTestId('name-input').fill('Oak');");
    expect(spec).toContain("await page.getByLabel('Password', { exact: true }).fill('a\\\\b');");
    expect(spec).toContain(
      "await page.getByRole('combobox', { name: 'Offered on', exact: true }).selectOption('tree');",
    );
    expect(spec).toContain("await page.keyboard.press('Enter');");
    expect(spec).toContain("await expect(page.getByText('Saved').first()).toBeVisible();");
    expect(spec).toContain(
      "await expect(page.getByRole('status', { name: 'Save status', exact: true })).toBeVisible();",
    );
    expect(spec).toContain('test.use({ viewport: { width: 360, height: 800 } });');
    expect(spec).toContain('// candidate: pending');
  });

  it('emits every expectation kind right after its step', () => {
    expect(expectations).toBe(7);
    expect(spec).toContain(
      "await expect(page.getByRole('navigation', { name: 'Path', exact: true })).toBeVisible();",
    );
    expect(spec).toContain(
      "await expect(page.getByRole('heading', { name: 'Tree', exact: true })).toContainText('Tree');",
    );
    expect(spec).toContain(
      "await expect(page.getByRole('listitem', { name: 'Row', exact: true })).toHaveCount(3);",
    );
    expect(spec).toContain(
      "await expect(page).toHaveURL(new RegExp('\\\\/builder\\\\/musterstadtbaeume\\\\/tree'));",
    );
    expect(spec).toContain("await expect(page.getByTestId('spinner')).toBeHidden();");
    expect(spec).toContain("await expect(page.getByLabel('Name', { exact: true })).toBeVisible();");
    const lines = spec.split('\n');
    const click4 = lines.findIndex((l) => l.includes('// 4:'));
    const urlExp = lines.findIndex((l) => l.includes('toHaveURL'));
    const step5 = lines.findIndex((l) => l.includes('// 5:'));
    expect(click4).toBeLessThan(urlExp);
    expect(urlExp).toBeLessThan(step5);
  });

  it('is deterministic and skips steps without a stable locator, and says so', () => {
    expect(generateSpec(doc).spec).toBe(spec);
    const r = generateSpec({ ...doc, steps: [at(1, 'click', null, [])], expectations: [] });
    expect(r.skipped).toBe(1);
    expect(r.spec).toContain('skipped: no stable locator');
    expect(r.spec).not.toContain('.click()');
  });

  it('keeps foreign origins absolute and rejects unknown commands', () => {
    const r = generateSpec({ journey: 'j', steps: [at(1, 'open', null, ['https://example.org/a'])] });
    expect(r.spec).toContain("await page.goto('https://example.org/a');");
    expect(() => generateSpec({ journey: 'j', steps: [at(1, 'hover', null, [])] })).toThrow(/hover/);
  });

  it('the CLI prints the same spec', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codegen-'));
    const file = join(dir, 'demo.steps.json');
    writeFileSync(file, JSON.stringify(doc));
    const script = fileURLToPath(new URL('./codegen.mjs', import.meta.url));
    expect(execFileSync(process.execPath, [script, file], { encoding: 'utf8', env: specEnv() })).toBe(spec);
  });
});

describe('validateExpect', () => {
  it('accepts the kinds and rejects malformed ones', () => {
    expect(validateExpect({ role: 'button', name: 'x', visible: true })).toEqual({
      role: 'button',
      name: 'x',
      visible: true,
    });
    expect(validateExpect({ text: 'hi' })).toEqual({ text: 'hi' });
    expect(validateExpect({ url: '/a' })).toEqual({ url: '/a' });
    expect(validateExpect({ role: 'button', visible: true })).toBeNull(); // role without name
    expect(validateExpect({ role: 'button', name: 'x' })).toBeNull(); // no kind
    expect(validateExpect({ visible: true })).toBeNull(); // no target
    expect(validateExpect({ role: 'a', name: 'b', count: -1 })).toBeNull();
    expect(validateExpect({ url: 'http://x' })).toBeNull();
    expect(validateExpect({ role: 'a', name: 'b', visible: true, text: 'c' })).toBeNull(); // two kinds
    expect(validateExpect('x')).toBeNull();
  });
  it('locatorExpr needs a role, testid or label', () => {
    expect(() => locatorExpr({})).toThrow();
  });
});

const FIXTURES = fileURLToPath(new URL('./journeys/fixtures/', import.meta.url));
const CANDIDATES = fileURLToPath(new URL('../../apps/web/e2e/candidates/', import.meta.url));

describe('golden files', () => {
  it('golden.steps.json generates exactly golden.spec.ts.txt (every locator and expectation kind)', () => {
    const steps = JSON.parse(readFileSync(`${FIXTURES}golden.steps.json`, 'utf8'));
    expect(generateSpec(steps).spec).toBe(readFileSync(`${FIXTURES}golden.spec.ts.txt`, 'utf8'));
  });

  it('every committed candidate regenerates byte-identically from its steps.json', () => {
    // Candidates come from local-model journey runs, so the folder may be empty (WP-1028 retired the stale ones);
    // every steps.json and its spec still come in pairs.
    const files = readdirSync(CANDIDATES);
    const specs = files.filter((f) => f.endsWith('.spec.ts'));
    const steps = files.filter((f) => f.endsWith('.steps.json'));
    expect(steps.map((f) => f.replace('.steps.json', '.spec.ts')).sort()).toEqual([...specs].sort());
    for (const f of specs) {
      const doc = JSON.parse(readFileSync(`${CANDIDATES}${f.replace('.spec.ts', '.steps.json')}`, 'utf8'));
      expect(readFileSync(`${CANDIDATES}${f}`, 'utf8'), f).toBe(
        generateSpec(doc).spec.replace('// candidate: pending', '// candidate: ready'),
      );
    }
  });
});

describe('injection', () => {
  const evil = 'x\u2028process.exit(1);\u2029await evil();\r\nawait evil2();//';
  const inj = generateSpec({
    journey: `j${evil}`,
    title: evil,
    steps: [
      at(1, 'seed', null, [evil]),
      at(2, 'open', null, [`${APP}/a?q=${evil}`]),
      at(3, 'fill', { label: evil }, [evil]),
      at(4, 'select', { testid: evil }, [evil]),
      at(5, 'press', null, [evil]),
      at(6, 'wait', null, [evil]),
    ],
    expectations: [{ after: 6, expect: { text: evil } }],
  }).spec;

  it('never lets a model-supplied character end a comment or a string', () => {
    for (const line of inj.split(/\r\n|[\n\r\u2028\u2029]/)) {
      expect(line.trim().startsWith('process.exit')).toBe(false);
      expect(line.trim().startsWith('await evil')).toBe(false);
    }
    expect(inj).not.toMatch(/[\r\u2028\u2029]/);
  });

  it('parses, and no statement other than the generated ones exists', () => {
    const body = inj.slice(inj.indexOf('  try {'), inj.indexOf('  } finally'));
    const fn = `async (expect, page, seedApp, url) => { let app; ${body.replace(/^\s*try \{/, '')} }`;
    expect(() => new Function(`return (${fn});`)).not.toThrow();
    const calls = [...inj.matchAll(/^\s*(?:await |app = await )?([\w.]+)\(/gm)].map((m) => m[1]);
    expect(calls.filter((c) => /evil|process/.test(c))).toEqual([]);
  });
});
