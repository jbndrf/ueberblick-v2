#!/usr/bin/env node
// WP-1011: how far are we, in percent? Reads metrics/parity/elements.json (one entry per v3 element of the
// placement register, each with a status that rests on evidence) and prints the share per step.
//   npm run -s parity [-- --missing]
// Statuses and how a lead updates an entry: docs/process/metrics.md, "Parity".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const STATUSES = ['verified', 'built', 'missing', 'owner', 'dropped'];
export const STEPS = [1, 2, 3, 4, 5];
const FILE = 'metrics/parity/elements.json';
const SPEC_LINE = /\.(spec|e2e)\.ts:\d+/;

const blank = () => ({
  verified: 0,
  built: 0,
  missing: 0,
  owner: 0,
  dropped: 0,
  all: 0,
  pctDone: 0,
  pctVerified: 0,
});

/** Problems in the file; an entry with an unknown status or step is not counted. */
export function checkEntries(entries) {
  const warnings = [];
  const seen = new Set();
  for (const x of entries) {
    const id = String(x.id);
    if (seen.has(id)) warnings.push(`duplicate id ${id}`);
    seen.add(id);
    if (!STATUSES.includes(x.status)) warnings.push(`unknown status "${x.status}" on ${id}`);
    if (!STEPS.includes(x.step)) warnings.push(`unknown step "${x.step}" on ${id}`);
    if (typeof x.evidence !== 'string' || x.evidence.trim() === '') warnings.push(`no evidence on ${id}`);
    else if (x.status === 'verified' && !SPEC_LINE.test(x.evidence))
      warnings.push(`verified without a spec path and line on ${id}: ${x.evidence}`);
  }
  return warnings;
}

const finish = (s) => {
  const counted = s.all - s.dropped;
  s.pctDone = counted > 0 ? ((s.verified + s.built) / counted) * 100 : 0;
  s.pctVerified = counted > 0 ? (s.verified / counted) * 100 : 0;
  return s;
};

/** Counts per step and in total. `% done = (verified + built) / (all - dropped)`. */
export function summarize(entries) {
  const steps = Object.fromEntries(STEPS.map((n) => [n, blank()]));
  const total = blank();
  for (const x of entries) {
    if (!STATUSES.includes(x.status) || !STEPS.includes(x.step)) continue;
    for (const s of [steps[x.step], total]) {
      s[x.status] += 1;
      s.all += 1;
    }
  }
  for (const s of [...Object.values(steps), total]) finish(s);
  return { steps, total };
}

/** The missing and owner elements, grouped by step. */
export function missingLines(entries) {
  const lines = [];
  for (const n of STEPS) {
    const open = entries.filter((x) => x.step === n && (x.status === 'missing' || x.status === 'owner'));
    if (open.length === 0) continue;
    lines.push(`Step ${n}: ${open.length} open`);
    for (const x of open) lines.push(`  ${x.status.padEnd(7)} ${x.id}  ${x.label}  (${x.evidence})`);
  }
  return lines;
}

const f1 = (n) => n.toFixed(1);

export function render(summary) {
  const head = ['', 'all', 'verified', 'built', 'missing', 'owner', 'dropped', '% done', '% verified'];
  const row = (name, s) => [
    name,
    s.all,
    s.verified,
    s.built,
    s.missing,
    s.owner,
    s.dropped,
    f1(s.pctDone),
    f1(s.pctVerified),
  ];
  const rows = [head, ...STEPS.map((n) => row(`Step ${n}`, summary.steps[n])), row('Total', summary.total)];
  const w = head.map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  return rows
    .map((r) => r.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join('  '))
    .join('\n');
}

export function summaryLine(summary) {
  const t = summary.total;
  return `${f1(t.pctDone)} % done, ${f1(t.pctVerified)} % verified (${t.verified + t.built} of ${t.all - t.dropped} elements, ${t.dropped} dropped)`;
}

export function loadEntries(file = FILE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = loadEntries();
  for (const w of checkEntries(entries)) console.warn(`warning: ${w}`);
  console.log(render(summarize(entries)));
  if (process.argv.includes('--missing')) console.log(`\n${missingLines(entries).join('\n')}`);
}
