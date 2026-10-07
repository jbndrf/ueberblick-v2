#!/usr/bin/env node
// Turns a journey's steps.json (recorded actions from the ui.mjs action log, plus the explorer's
// expectations as data) into a Playwright test candidate. Deterministic: the model writes no code
// (docs/process/journeys.md part C).
//   node scripts/ui/codegen.mjs <journey>.steps.json [--out <file>]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The expectation kinds; an expectation has exactly one of these keys. */
export const EXPECT_KEYS = ['visible', 'count', 'text', 'url'];
const ELEMENT_ACTIONS = ['click', 'fill', 'select'];
const TARGET_KEYS = ['role', 'name', 'testid', 'label'];

/** A JS string literal. Every line terminator (incl. U+2028/2029) is escaped, so a model-supplied value stays data. */
const q = (s) =>
  `'${String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;
/** Text for a // comment: no line terminator of any kind survives. */
const oneLine = (s) => String(s).replace(/[\r\n\u2028\u2029]+/g, ' ');
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Checks one expectation: a target ({role, name} | {testid} | {label}, optional for `text` and `url`) and one
 * kind (`visible` boolean, `count` integer, `text` string, `url` path). Returns the normalized object, or
 * null when it is not one codegen knows.
 */
export function validateExpect(e) {
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return null;
  const kinds = EXPECT_KEYS.filter((k) => e[k] !== undefined);
  if (kinds.length !== 1) return null;
  const kind = kinds[0];
  const out = {};
  for (const k of TARGET_KEYS) {
    if (e[k] === undefined) continue;
    if (typeof e[k] !== 'string' || e[k] === '') return null;
    out[k] = e[k];
  }
  if ((out.role === undefined) !== (out.name === undefined)) return null;
  const targeted = out.role !== undefined || out.testid !== undefined || out.label !== undefined;
  if (kind === 'visible' && typeof e.visible !== 'boolean') return null;
  if (kind === 'count' && !(Number.isInteger(e.count) && e.count >= 0)) return null;
  if (kind === 'text' && (typeof e.text !== 'string' || e.text === '')) return null;
  if (kind === 'url' && (typeof e.url !== 'string' || !e.url.startsWith('/') || targeted)) return null;
  if ((kind === 'visible' || kind === 'count') && !targeted) return null;
  out[kind] = e[kind];
  return out;
}

/** `page.getByRole(...)`-style expression for an action-log locator or an expectation. */
export function locatorExpr(l) {
  let base;
  if (l.role !== undefined) base = `page.getByRole(${q(l.role)}, { name: ${q(l.name)}, exact: true })`;
  else if (l.testid !== undefined) base = `page.getByTestId(${q(l.testid)})`;
  else if (l.label !== undefined) base = `page.getByLabel(${q(l.label)}, { exact: true })`;
  else throw new Error(`locator has no role, testid or label: ${JSON.stringify(l)}`);
  return l.nth === undefined ? base : `${base}.nth(${l.nth})`;
}

function expectationLine(e) {
  const targeted = e.role !== undefined || e.testid !== undefined || e.label !== undefined;
  if (e.url !== undefined) return `await expect(page).toHaveURL(new RegExp(${q(reEscape(e.url))}));`;
  if (!targeted) return `await expect(page.getByText(${q(e.text)}).first()).toBeVisible();`;
  const loc = locatorExpr(e);
  if (e.count !== undefined) return `await expect(${loc}).toHaveCount(${e.count});`;
  if (e.text !== undefined) return `await expect(${loc}).toContainText(${q(e.text)});`;
  return `await expect(${loc}).${e.visible ? 'toBeVisible' : 'toBeHidden'}();`;
}

function stepLines(s, origin) {
  const [a0] = s.args ?? [];
  const label = `${s.cmd}${s.locator ? ` ${JSON.stringify(s.locator)}` : ''}${s.args?.length ? ` ${JSON.stringify(s.args)}` : ''}`;
  const head = `// ${s.n}: ${oneLine(label)}`;
  if (s.cmd === 'seed') return { lines: [head, `app = await seedApp(page, ${q(a0)});`] };
  if (s.cmd === 'open') {
    const u = new URL(a0);
    const rel = u.origin === origin ? `${u.pathname}${u.search}${u.hash}` : null;
    return {
      lines: [head, rel === null ? `await page.goto(${q(a0)});` : `await page.goto(url(${q(rel)}));`],
    };
  }
  if (s.cmd === 'press') return { lines: [head, `await page.keyboard.press(${q(a0)});`] };
  if (s.cmd === 'wait') {
    const target = s.locator ? locatorExpr(s.locator) : `page.getByText(${q(a0)}).first()`;
    return { lines: [head, `await expect(${target}).toBeVisible();`] };
  }
  if (ELEMENT_ACTIONS.includes(s.cmd)) {
    if (!s.locator)
      return {
        lines: [head, '// skipped: no stable locator (role+name, testid or label) for this element'],
        skipped: true,
      };
    const call =
      s.cmd === 'click' ? 'click()' : s.cmd === 'fill' ? `fill(${q(a0)})` : `selectOption(${q(a0)})`;
    return { lines: [head, `await ${locatorExpr(s.locator)}.${call};`] };
  }
  throw new Error(`step ${s.n}: codegen does not know the command "${s.cmd}"`);
}

/** The origin of the app a seed started: the first `open` after a `seed`. */
function appOrigin(steps) {
  const i = steps.findIndex((s) => s.cmd === 'seed');
  const open = i < 0 ? undefined : steps.slice(i + 1).find((s) => s.cmd === 'open');
  return open === undefined ? null : new URL(open.args[0]).origin;
}

/**
 * @param {{journey: string, title?: string, viewport?: {width:number,height:number}|null, steps: object[], expectations?: object[]}} doc
 * @returns {{ spec: string, skipped: number, expectations: number }}
 */
export function generateSpec(doc) {
  const origin = appOrigin(doc.steps);
  const expects = (doc.expectations ?? []).flatMap((x) => {
    const e = validateExpect(x.expect);
    return e === null ? [] : [{ after: x.after, e }];
  });
  const body = [];
  const emitExpects = (n) => {
    for (const x of expects) if (x.after === n) body.push(expectationLine(x.e));
  };
  emitExpects(0);
  let skipped = 0;
  for (const s of doc.steps) {
    const r = stepLines(s, origin);
    if (r.skipped) skipped++;
    body.push(...r.lines);
    emitExpects(s.n);
  }
  const vp = doc.viewport
    ? [`test.use({ viewport: { width: ${doc.viewport.width}, height: ${doc.viewport.height} } });`, '']
    : [];
  const lines = [
    `// Generated by scripts/ui/codegen.mjs from ${oneLine(doc.journey)}.steps.json. Do not edit: change the journey and rerun it.`,
    '// candidate: pending',
    "import { expect, test } from '@playwright/test';",
    "import { seedApp, type SeededApp } from './harness';",
    '',
    ...vp,
    `test(${q(`${doc.journey}: ${doc.title ?? doc.journey}`)}, async ({ page }) => {`,
    '  let app: SeededApp | undefined;',
    '  const url = (path: string): string => {',
    "    if (app === undefined) throw new Error('no app seeded yet');",
    '    return `${app.url}${path}`;',
    '  };',
    '  try {',
    ...body.map((l) => `    ${l}`),
    '  } finally {',
    '    await app?.stop();',
    '  }',
    '});',
    '',
  ];
  return { spec: lines.join('\n'), skipped, expectations: expects.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--out');
  if (file === undefined) {
    console.error('usage: node scripts/ui/codegen.mjs <journey>.steps.json [--out <file>]');
    process.exit(2);
  }
  const { spec, skipped } = generateSpec(JSON.parse(readFileSync(file, 'utf8')));
  const i = process.argv.indexOf('--out');
  if (i > 0) writeFileSync(process.argv[i + 1], spec);
  else process.stdout.write(spec);
  if (skipped) console.error(`codegen: ${skipped} step(s) had no stable locator and were skipped`);
}
