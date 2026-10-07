// Rework metric (WP-1020): every done work package is classed new / fix / tooling / test / docs, with the rule
// that decided, so the class can be audited. classify() is pure; loadRows() reads work/*.md and the land commits.
// Usage: node scripts/metrics/rework.mjs [--days N] [--list <class>]
import { readdirSync, readFileSync } from 'node:fs';
import { git } from './lib.mjs';

export const CLASSES = ['new', 'fix', 'tooling', 'test', 'docs'];
const FIX_TITLE =
  /\b(fix(es|ed)?|repair|regress\w*|follow-?ups?|flak(e|y)|bugs?|hole|leaks?|broken|unusable|wrongly|stale|never silently|cleanups?|hardening|crash\w*|race|drift|miss|silent(ly)?|red (on|after|in)|quarantin\w*|blocker)\b/i;
const FIX_ORIGIN =
  /\b(QA hunt|security hunt|privacy hunt|bug hunt|hunt of|found by (a|the) hunt|QA hunts?|follow-?ups? from|(journey|researcher|review|reviews) found|found by [\w-]+ in the|(fails|red) on main)\b/i;
const BROKE =
  /\b(broke|broken|bug|regress\w*|wrong|crash\w*|fails?|failing|red main|leaks?|does not work|doesn't work)\b/i;
const TEST_TITLE =
  /\b(e2e|tests?|specs?)\s+(for|of|coverage)\b|\b(e2e|test) coverage\b|\b(e2e|test|golden|simulation) (fakes|helpers|harness|runner|corpus)\b/i;
const TOOLING_PATH =
  /^(scripts|\.claude|metrics|ops|bench|\.github|\.githooks|work|tsconfig[\w.-]*\.json|\.[\w.-]+\.c?js|package(-lock)?\.json|[\w.-]+\.config\.[\w]+)(\/|$)/;
const TEST_PATH =
  /(\.testing\.[mc]?[tj]s|\/testing\/|\.spec\.[mc]?[tj]s|\.test\.[mc]?[tj]s|(^|\/)e2e\/|__fixtures__\/|^fixtures\/)/;
const DOCS_PATH = /^docs\/|(^|\/)README\.md$/;

/** Frontmatter and Goal of a work package file as { fm, goal }. Lists (owns, depends) become arrays. */
export function parseWp(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const fm = {};
  let key = null;
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim().replace(/^"(.*)"$/, '$1');
      fm[key] = v === '' || v === '[]' ? [] : v;
    } else if (key && Array.isArray(fm[key]) && /^\s*-\s+/.test(line))
      fm[key].push(
        line
          .replace(/^\s*-\s+/, '')
          .split(/\s+\(/)[0]
          .replace(/^"(.*)"$/, '$1')
          .trim(),
      );
  }
  const goal = (m?.[2] ?? '').match(/## Goal\n([\s\S]*?)(\n## |$)/)?.[1]?.trim() ?? '';
  return { fm, goal };
}

/** Lane of a work package: lead-c's series (WP-9xx, WP-10xx) is the steward lane, the rest is product. */
export function laneOf(id) {
  return Number(id.match(/WP-(\d+)/)?.[1] ?? 0) >= 900 ? 'lead-c' : 'product';
}

/** Class one work package. `doneIds` is the set of done WP ids (for the depends signal).
 * Returns { class, rule }; rule names what decided. */
export function classify({ id, fm, goal = '' }, doneIds = new Set()) {
  if (fm.kind && CLASSES.includes(fm.kind)) return { class: fm.kind, rule: 'kind: frontmatter' };
  const title = String(fm.title ?? '');
  const owns = Array.isArray(fm.owns) ? fm.owns : [];
  // the WP's own file in work/ never decides the class
  const paths = owns.filter((o) => !/^work\/WP-/.test(o));
  if (paths.length && paths.every((o) => DOCS_PATH.test(o)))
    return { class: 'docs', rule: 'owns: only docs' };
  if (FIX_TITLE.test(title)) return { class: 'fix', rule: 'title: fix word' };
  if (FIX_ORIGIN.test(goal)) return { class: 'fix', rule: 'goal: hunt or follow-up origin' };
  const dependsDone = (Array.isArray(fm.depends) ? fm.depends : []).some((d) => doneIds.has(d));
  if (dependsDone && BROKE.test(goal.slice(0, 500)))
    return { class: 'fix', rule: 'depends on done WP + goal says something broke' };
  const strongBroke = /\b(fails?|failing|regress\w*|crash\w*|red|bug)\b/i;
  if (/WP-\d+/.test(goal.slice(0, 250)) && strongBroke.test(goal.slice(0, 250)))
    return { class: 'fix', rule: 'goal: names an earlier WP and says it fails' };
  if (TEST_TITLE.test(title)) return { class: 'test', rule: 'title: tests for' };
  if (paths.length && paths.every((o) => TEST_PATH.test(o)))
    return { class: 'test', rule: 'owns: only specs' };
  if (paths.length && paths.every((o) => TOOLING_PATH.test(o) || TEST_PATH.test(o)))
    return { class: 'tooling', rule: 'owns: only tooling paths and specs' };
  if (
    paths.some((o) => TOOLING_PATH.test(o)) &&
    paths.every((o) => TOOLING_PATH.test(o) || /^docs\/process\//.test(o))
  )
    return { class: 'tooling', rule: 'owns: tooling paths and process docs' };
  if (laneOf(id) === 'lead-c') return { class: 'tooling', rule: 'lane: lead-c' };
  return { class: 'new', rule: 'default: builds something users see or use' };
}

/** Land dates { 'WP-1': 'YYYY-MM-DD' } from `<date> chore(wp): WP-x done` lines (earliest wins). */
export function landDates(log) {
  const out = {};
  for (const line of log.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}) chore\(wp\): (WP-[\d.]+) done/);
    if (m && !(out[m[2]] && out[m[2]] < m[1])) out[m[2]] = m[1];
  }
  return out;
}

/** Classify all done WPs. `files` is [{ id, text }], `dates` from landDates. */
export function classifyAll(files, dates = {}) {
  const parsed = files
    .map(({ id, text }) => ({ id, ...parseWp(text) }))
    .filter((w) => w.fm.status === 'done');
  const doneIds = new Set(parsed.map((w) => w.id));
  return parsed.map((w) => ({
    id: w.id,
    title: String(w.fm.title ?? ''),
    lane: laneOf(w.id),
    date: dates[w.id] ?? null,
    ...classify(w, doneIds),
  }));
}

const share = (n, t) => (t ? `${Math.round((100 * n) / t)}%` : '0%');
const LANES = ['product', 'lead-c'];

/** Counts per class for a list of rows. */
export const countBy = (rows) =>
  Object.fromEntries(CLASSES.map((c) => [c, rows.filter((r) => r.class === c).length]));

const window = (rows, today, days) => {
  const from = new Date(new Date(today).getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => r.date && r.date > from && r.date <= today);
};

/** The one report row: "landed WPs (7 days): new x% · fix y% · tooling z% · test · docs". */
export function reportRow(rows, today, days = 7) {
  const recent = window(rows, today, days);
  const c = countBy(recent);
  const t = recent.length;
  return [
    `landed WPs (${days} days)`,
    t ? `${t}: ` + CLASSES.map((k) => `${k} ${share(c[k], t)}`).join(' · ') : 'none landed',
    'share of landed work packages by class (`npm run -s metrics:rework`)',
  ];
}

/** Per-day text report: count and share per class, and the lane split. */
export function dayReport(rows, today, days = 7) {
  const recent = window(rows, today, days);
  const line = (label, rs) => {
    const c = countBy(rs);
    return [
      label,
      rs.length,
      ...CLASSES.map((k) => `${c[k]} (${share(c[k], rs.length)})`),
      LANES.map((l) => `${l} ${rs.filter((r) => r.lane === l).length}`).join(', '),
    ].join(' | ');
  };
  return [
    ['day', 'landed', ...CLASSES, 'lanes'].join(' | '),
    ...[...new Set(recent.map((r) => r.date))].sort().map((d) =>
      line(
        d,
        recent.filter((r) => r.date === d),
      ),
    ),
    line('total', recent),
    `${rows.filter((r) => !r.date).length} undated (done WPs without a land commit, not in the days above)`,
  ].join('\n');
}

/** Read work/*.md and the land commits of the current checkout. */
export function loadRows(workDir = 'work') {
  const files = readdirSync(workDir)
    .filter((f) => /^WP-[\d.]+.*\.md$/.test(f))
    .map((f) => ({ id: f.match(/^(WP-\d+(?:\.\d+)*)/)[1], text: readFileSync(`${workDir}/${f}`, 'utf8') }));
  const log = git('log', '--grep=^chore(wp): WP-', '--format=%ad %s', '--date=short');
  return classifyAll(files, landDates(log));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
  const rows = loadRows();
  const today = new Date().toISOString().slice(0, 10);
  const list = arg('--list');
  if (list) {
    if (!CLASSES.includes(list)) throw new Error(`class must be one of ${CLASSES.join(', ')}`);
    const days = arg('--days');
    const sel = days ? window(rows, today, Number(days)) : rows;
    for (const r of sel.filter((x) => x.class === list))
      console.log(`${r.id}\t${r.date ?? '-'}\t${r.rule}\t${r.title}`);
  } else console.log(dayReport(rows, today, Number(arg('--days') ?? 7)));
}
