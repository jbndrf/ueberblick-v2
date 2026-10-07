import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without declarations
import * as d from './main-watch-details.mjs';
// @ts-expect-error plain .mjs without declarations
import * as mw from './main-watch.mjs';

interface Detail {
  message: string;
  location: string;
  stdout: string;
  stderr: string;
  attempts: number;
  attachments: string[];
}
interface Entry {
  id: string;
  detail: Detail;
}
const lib = d as {
  renderDetails: (p: { sha: string; entries: Entry[] }) => string;
  writeDetails: (p: { dir: string; sha: string; nowMs: number; entries: Entry[] }) => string;
  extractDetail: (r: Record<string, unknown>, retries?: number) => Detail;
};
const watchLib = mw as {
  summarizeSuite: (
    s: { id: string; name: string },
    r: unknown,
  ) => { failing: { id: string; error: string }[]; details: Entry[] };
  watch: (p: Record<string, unknown>) => Promise<{ row?: Record<string, unknown> }>;
};

const detail = (over: Partial<Detail> = {}): Detail => ({
  message: 'Error: boom',
  location: '',
  stdout: '',
  stderr: '',
  attempts: 1,
  attachments: [],
  ...over,
});
const lines = (n: number, p = 'line') => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`).join('\n');
const tmp = () => mkdtempSync(join(tmpdir(), 'mwd-'));
const NOW = Date.UTC(2026, 9, 5, 14, 7);

describe('details file content', () => {
  it('holds the full message, not the first line', () => {
    const md = lib.renderDetails({
      sha: 'abcdef1234',
      entries: [{ id: 's:a.spec.ts:1:t', detail: detail({ message: 'toEqual\nPOST /runs 500 internal' }) }],
    });
    expect(md).toContain('## s:a.spec.ts:1:t');
    expect(md).toContain('POST /runs 500 internal');
  });
  it('caps the message at 80 lines and says so', () => {
    const md = lib.renderDetails({
      sha: 'abcdef1',
      entries: [{ id: 'x', detail: detail({ message: lines(100) }) }],
    });
    expect(md).toContain('line 80');
    expect(md).not.toContain('line 81\n');
    expect(md).toContain('[cut: 20 more lines]');
  });
  it('strips ANSI codes', () => {
    const md = lib.renderDetails({
      sha: 'abcdef1',
      entries: [{ id: 'x', detail: detail({ message: '\u001b[31mred\u001b[39m' }) }],
    });
    expect(md).toContain('red');
    expect(md).not.toContain('\u001b');
  });
  it('shows location, attempts, attachments and the stdout and stderr tails (40 lines)', () => {
    const md = lib.renderDetails({
      sha: 'abcdef1',
      entries: [
        {
          id: 'x',
          detail: detail({
            location: 'a.spec.ts:12:3',
            attempts: 3,
            attachments: ['/t/trace.zip'],
            stdout: lines(50, 'out'),
            stderr: 'err only',
          }),
        },
      ],
    });
    expect(md).toContain('Location: a.spec.ts:12:3');
    expect(md).toContain('Attempts: 3');
    expect(md).toContain('- /t/trace.zip');
    expect(md).toContain('out 50');
    expect(md).not.toContain('out 10\n');
    expect(md).toContain('[cut: 10 earlier lines]');
    expect(md).toContain('err only');
  });
  it('extracts detail from a Playwright result', () => {
    const x = lib.extractDetail(
      {
        errors: [{ message: 'm', location: { file: 'f.ts', line: 4, column: 2 } }],
        stdout: [{ text: 'hi\n' }, 'there'],
        attachments: [{ path: '/p/trace.zip' }, { name: 'none' }],
      },
      2,
    );
    expect(x).toMatchObject({ message: 'm', location: 'f.ts:4:2', stdout: 'hi\nthere', attempts: 3 });
    expect(x.attachments).toEqual(['/p/trace.zip']);
  });
});

describe('details file on disk', () => {
  it('is named by UTC minute and sha7, in the injected directory, and returned repo-relative', () => {
    const dir = join(tmp(), 'e2e');
    const rel = lib.writeDetails({
      dir,
      sha: 'abcdef1234',
      nowMs: NOW,
      entries: [{ id: 'x', detail: detail() }],
    });
    expect(rel).toBe('metrics/raw/e2e/main-2026-10-05T14-07-abcdef1.md');
    expect(readFileSync(join(dir, 'main-2026-10-05T14-07-abcdef1.md'), 'utf8')).toContain('Error: boom');
  });
  it('prunes main-*.md older than 14 days and nothing else', () => {
    const dir = tmp();
    mkdirSync(dir, { recursive: true });
    const old = new Date(NOW - 15 * 86_400_000);
    const fresh = new Date(NOW - 2 * 86_400_000);
    for (const [f, t] of [
      ['main-old.md', old],
      ['main-fresh.md', fresh],
      ['other-old.md', old],
    ] as const) {
      writeFileSync(join(dir, f), 'x');
      utimesSync(join(dir, f), t, t);
    }
    lib.writeDetails({ dir, sha: 'abcdef1', nowMs: NOW, entries: [{ id: 'x', detail: detail() }] });
    expect(readdirSync(dir).sort()).toEqual([
      'main-2026-10-05T14-07-abcdef1.md',
      'main-fresh.md',
      'other-old.md',
    ]);
  });
});

describe('summarizeSuite keeps the detail', () => {
  it('returns the first line in failing and the full error in details', () => {
    const report = {
      stats: { expected: 0, unexpected: 1 },
      suites: [
        {
          specs: [
            {
              file: 'l.spec.ts',
              line: 122,
              title: 'liste',
              tests: [
                {
                  retries: 1,
                  results: [
                    {
                      status: 'failed',
                      error: { message: 'toEqual (deep equality)\nPOST /runs 500' },
                      stdout: [{ text: 'srv log' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const s = watchLib.summarizeSuite({ id: 'p', name: 'p' }, report);
    expect(s.failing).toEqual([{ id: 'p:l.spec.ts:122:liste', error: 'toEqual (deep equality)' }]);
    expect(s.details[0]?.detail.message).toContain('POST /runs 500');
    expect(s.details[0]?.detail.attempts).toBe(2);
  });
});

describe('watch with details', () => {
  const run = (red: boolean) => async () => ({
    suites: [
      {
        id: 'a',
        name: 'a',
        passed: 1,
        failed: red ? 1 : 0,
        failing: red ? [{ id: 'a:x.spec.ts:1:t', error: 'first' }] : [],
        details: red ? [{ id: 'a:x.spec.ts:1:t', detail: detail({ message: 'first\nsecond' }) }] : [],
      },
    ],
    exit: red ? 1 : 0,
  });
  const make = (red: boolean) => {
    const dir = join(tmp(), 'e2e');
    const appended: Record<string, unknown>[] = [];
    const alarms: { title: string; lines: string[] }[] = [];
    return {
      dir,
      appended,
      alarms,
      params: {
        head: 'abcdef1234',
        rows: [],
        load: 0,
        cores: 4,
        runE2e: run(red),
        now: () => NOW,
        append: (e: Record<string, unknown>) => appended.push(e),
        attention: (title: string, l: string[]) => alarms.push({ title, lines: l }),
        log: () => undefined,
        writeDetails: (p: Record<string, unknown>) =>
          lib.writeDetails({ ...(p as { sha: string; nowMs: number; entries: Entry[] }), dir }),
      },
    };
  };
  it('a red run writes the file, the row carries details, ATTENTION names the file, no detail leaks into the row', async () => {
    const g = make(true);
    await watchLib.watch(g.params);
    const rel = 'metrics/raw/e2e/main-2026-10-05T14-07-abcdef1.md';
    expect(g.appended[0]?.details).toBe(rel);
    expect(JSON.stringify(g.appended[0])).not.toContain('second');
    expect(g.alarms[0]?.lines.at(-1)).toBe(`full errors: ${rel}`);
    expect(readFileSync(join(g.dir, rel.split('/').pop() ?? ''), 'utf8')).toContain('second');
  });
  it('a green run writes no file and no details field', async () => {
    const g = make(false);
    await watchLib.watch(g.params);
    expect(existsSync(g.dir)).toBe(false);
    expect(g.appended[0]).not.toHaveProperty('details');
  });
});
