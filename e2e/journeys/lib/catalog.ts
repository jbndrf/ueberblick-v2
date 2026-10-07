/**
 * Reads the journey specs without running them: every `test(` / `test.fixme(` with its header comment (Purpose, v3,
 * Taps in v3, Owner decision), and the table in docs/process/v3-journeys.md. Plain node, no Playwright, so a unit spec
 * can check both (scripts/e2e/journeys.spec.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const AREAS = Object.freeze([
  { area: 'participant-entry', lane: 'lead-b' },
  { area: 'participant-map', lane: 'lead-b' },
  { area: 'participant-feature', lane: 'lead-b' },
  { area: 'admin-projects-people', lane: 'lead-a' },
  { area: 'admin-settings-data', lane: 'lead-a' },
  { area: 'admin-builder-deploy', lane: 'lead-a' },
]);

export interface Journey {
  readonly area: string;
  readonly id: string;
  readonly title: string;
  readonly status: 'fixme' | 'green';
  readonly purpose: string | undefined;
  readonly v3: string | undefined;
  readonly taps: string | undefined;
  readonly ownerDecision: string | undefined;
  readonly harnessProof: boolean;
  readonly waitsFor: string | undefined;
  readonly line: number;
}

const TEST_START = /^\s*test(\.fixme)?\(/;
/** The title may sit on the next line (prettier wraps long calls). */
const TEST_CALL = /test(\.fixme)?\(\s*(['"`])(.+?)\2/;

/** Journeys of one spec file's text, in file order. */
export function parseJourneys(area: string, text: string): Journey[] {
  const lines = text.split('\n');
  const out: Journey[] = [];
  lines.forEach((line, i) => {
    if (!TEST_START.test(line)) return;
    const m = TEST_CALL.exec(lines.slice(i, i + 3).join(' '));
    if (m === null) return;
    const header: string[] = [];
    for (let j = i - 1; j >= 0 && /^\s*\/\/ /.test(lines[j] ?? ''); j--)
      header.unshift((lines[j] ?? '').trim().slice(3));
    const field = (key: string): string | undefined =>
      header
        .find((h) => h.startsWith(`${key}:`))
        ?.slice(key.length + 1)
        .trim();
    const v3 = field('v3');
    const title = m[3] ?? '';
    const head = lines.slice(i, i + 5).join(' ');
    out.push({
      area,
      id: title.split(' ')[0] ?? '',
      title,
      status: m[1] === undefined ? 'green' : 'fixme',
      purpose: field('Purpose'),
      v3: v3?.replace(/\s+Taps in v3:.*$/, ''),
      taps: v3 === undefined ? undefined : /Taps in v3:\s*(\S+)/.exec(v3)?.[1],
      ownerDecision: field('Owner decision'),
      harnessProof: title.includes('[harness proof]'),
      waitsFor: /waitsFor\('([^']+)'\)/.exec(head)?.[1],
      line: i + 1,
    });
  });
  return out;
}

/** Every journey of `dir` (the e2e/journeys directory), area by area. */
export function readJourneys(dir: string): Journey[] {
  return AREAS.flatMap(({ area }) => {
    const file = join(dir, `${area}.spec.ts`);
    return existsSync(file) ? parseJourneys(area, readFileSync(file, 'utf8')) : [];
  });
}

export interface DocRow {
  readonly id: string;
  readonly area: string;
  readonly lane: string;
  readonly title: string;
  readonly status: string;
}

/** The rows of the journey table: `| id | area | lane | title | status |`. */
export function parseDocTable(text: string): DocRow[] {
  const rows: DocRow[] = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 7 || !/^[A-Z]{2}-\d{2}$/.test(cells[1] ?? '')) continue;
    const [, id = '', area = '', lane = '', title = '', status = ''] = cells;
    rows.push({ id, area, lane, title, status });
  }
  return rows;
}

/** Problems between the specs and the doc table; empty when they match. */
export function catalogProblems(journeys: readonly Journey[], rows: readonly DocRow[]): string[] {
  const out: string[] = [];
  const lane = new Map(AREAS.map((a) => [a.area, a.lane]));
  for (const j of journeys) {
    const at = `${j.area}.spec.ts:${j.line} ${j.id}`;
    if (!/^[A-Z]{2}-\d{2}$/.test(j.id)) out.push(`${at}: the title must start with the journey id`);
    if (j.purpose === undefined || j.purpose === '') out.push(`${at}: missing "// Purpose:" line`);
    if (j.v3 === undefined || !/\S+:\d+/.test(j.v3)) out.push(`${at}: missing "// v3: <file:line>" line`);
    if (j.taps === undefined) out.push(`${at}: missing "Taps in v3:" on the v3 line`);
    if (j.status === 'fixme' && j.waitsFor === undefined)
      out.push(`${at}: fixme without a "waits for ..." reason`);
    const row = rows.find((r) => r.id === j.id);
    if (row === undefined) {
      out.push(`${at}: not in docs/process/v3-journeys.md`);
      continue;
    }
    if (row.title !== j.title) out.push(`${at}: doc title "${row.title}" differs`);
    if (row.area !== j.area) out.push(`${at}: doc area "${row.area}" differs`);
    if (row.lane !== lane.get(j.area)) out.push(`${at}: doc lane "${row.lane}" differs`);
    if (row.status !== j.status) out.push(`${at}: doc status "${row.status}", spec says ${j.status}`);
  }
  const ids = journeys.map((j) => j.id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) out.push(`${id}: duplicate id`);
  for (const r of rows) if (!ids.includes(r.id)) out.push(`${r.id}: in the doc but in no spec`);
  return out;
}
