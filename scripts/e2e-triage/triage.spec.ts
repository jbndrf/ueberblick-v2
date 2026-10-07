import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs runner without declarations
import { SUITES as RAW_SUITES } from '../e2e/run.mjs';
import { e2eRows } from '../metrics/e2e-rows.mjs';
import {
  MAX_PROMPT_CHARS,
  buildPrompt,
  collectFailures,
  runTriage,
  waitForGpu,
  traceSummary,
  type Failure,
} from './lib.mjs';

const report = JSON.parse(readFileSync(join(__dirname, 'fixtures/red-report.json'), 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'e2e-triage-'));
const NOW = new Date('2026-09-30T12:34:56Z');

type Msg = { role: string; content: unknown };
const answer = (cls: string, confidence: string) =>
  JSON.stringify({ class: cls, confidence, evidence: `ev ${cls}`, next: `fix ${cls}` });
const usage = { input: 100, output: 10 };

function fakeModel(replies: (title: string) => string[] | Error, free = true) {
  const calls: Msg[][] = [];
  const seen = new Map<string, number>();
  return {
    calls,
    gpuFree: async () => free,
    chat: async (messages: Msg[]) => {
      calls.push(messages);
      const text = JSON.stringify(messages);
      const title =
        ['participant opens a task', 'map shows markers', 'sync after reload'].find((t) =>
          text.includes(t),
        ) ?? '';
      const n = seen.get(title) ?? 0;
      seen.set(title, n + 1);
      const r = replies(title);
      if (r instanceof Error) throw r;
      return { text: r[Math.min(n, r.length - 1)] ?? '', ms: 5, usage, model: 'fake' };
    },
  };
}

const opts = (dir: string, model: ReturnType<typeof fakeModel>) => ({
  reports: [{ suite: 'apps/web', report }],
  model,
  dir,
  now: NOW,
  waitMs: 0,
  readTrace: () => null,
  readImage: () => null,
});

const ROOT = join(__dirname, '..', '..');
const SUITES = RAW_SUITES as readonly { name: string; config: string; report: string }[];
const green = { suites: [] };
const a11yReport = {
  suites: [
    {
      file: 'pages.spec.ts',
      specs: [
        {
          file: 'pages.spec.ts',
          line: 7,
          title: 'control page has no violations',
          tests: [{ results: [{ status: 'failed', error: { message: 'axe: 2 violations' } }] }],
        },
      ],
    },
  ],
};

describe('suites', () => {
  it('fixture reports for two suites: one .md with both groups and right bySuite counts', async () => {
    const dir = tmp();
    const model = fakeModel(() => [answer('env', 'low')]);
    const r = await runTriage({
      ...opts(dir, model),
      reports: [
        { suite: 'apps/web', report },
        { suite: 'e2e/a11y', report: a11yReport },
        { suite: 'e2e/participant', report: green },
      ],
    });
    expect(r.bySuite).toEqual({ 'apps/web': 3, 'e2e/a11y': 1 });
    const files = readdirSync(join(dir, 'e2e'));
    expect(files).toHaveLength(1);
    const md = readFileSync(join(dir, 'e2e', files[0] ?? ''), 'utf8');
    expect(md).toContain('# apps/web (3)');
    expect(md).toContain('# e2e/a11y (1)');
    expect(md.indexOf('# apps/web')).toBeLessThan(md.indexOf('# e2e/a11y'));
    expect(md).toContain('control page has no violations');
    const line = JSON.parse(readFileSync(join(dir, 'e2e.jsonl'), 'utf8').trim());
    expect(line).toMatchObject({ failures: 4, bySuite: { 'apps/web': 3, 'e2e/a11y': 1 } });
  });

  it('a suite whose report is missing is an env finding without a model call', async () => {
    const dir = tmp();
    const model = fakeModel(() => [answer('app-bug', 'high')]);
    const r = await runTriage({
      ...opts(dir, model),
      reports: [{ suite: 'e2e/participant', report: null }],
    });
    expect(model.calls).toHaveLength(0);
    expect(r.byClass).toEqual({ env: 1 });
    expect(r.bySuite).toEqual({ 'e2e/participant': 1 });
    const md = readFileSync(r.file, 'utf8');
    expect(md).toContain('report missing');
    expect(existsSync(join(dir, 'ATTENTION.md'))).toBe(false);
  });

  it('guard: every SUITES entry has a report path and its config writes JSON there', () => {
    for (const s of SUITES) {
      expect(s.report, s.name).toMatch(/\.json$/);
      const src = readFileSync(join(ROOT, s.config), 'utf8');
      const fromConfig = relative(dirname(join(ROOT, s.config)), join(ROOT, s.report));
      expect(src, s.name).toContain("['json'");
      expect(src.includes(fromConfig) || src.includes('E2E_REPORT'), s.name).toBe(true);
      expect(src, s.name).toContain("trace: 'retain-on-failure'");
      expect(src, s.name).toContain("screenshot: 'only-on-failure'");
    }
    const web = readFileSync(join(ROOT, 'apps/web/playwright.config.ts'), 'utf8');
    expect(web).toContain("E2E_REPORT = 'test-results/e2e-report.json'");
    expect(SUITES[0]?.report).toBe('apps/web/test-results/e2e-report.json');
  });

  it('apps/web config ignores journey candidates (WP-902)', () => {
    expect(readFileSync(join(ROOT, 'apps/web/playwright.config.ts'), 'utf8')).toContain(
      "testIgnore: 'candidates/**'",
    );
  });

  it('waitForGpu polls until free, or gives up after the wait', async () => {
    let n = 0;
    expect(await waitForGpu({ gpuFree: async () => ++n >= 3 }, 1000, 1)).toBe(true);
    expect(n).toBe(3);
    expect(await waitForGpu({ gpuFree: async () => false }, 0)).toBe(false);
  });
});

describe('collectFailures', () => {
  it('finds the three failing tests and skips passing ones', () => {
    const f = collectFailures(report);
    expect(f.map((x: { title: string }) => x.title)).toEqual([
      'participant opens a task',
      'map shows markers',
      'sync after reload',
    ]);
    expect(f[0]).toMatchObject({ spec: 'flow.spec.ts:12', failingStep: 'expect toHaveText' });
    expect(f[2]?.error).toContain('net::ERR_CONNECTION_REFUSED');
    expect(f[0]?.console).toContain('save handler threw');
  });
});

describe('runTriage', () => {
  it('writes the .md, one e2e.jsonl line and ATTENTION only for a high-confidence app-bug', async () => {
    const dir = tmp();
    const model = fakeModel((t) => [
      t === 'participant opens a task'
        ? answer('app-bug', 'high')
        : t === 'map shows markers'
          ? answer('app-bug', 'medium')
          : answer('env', 'high'),
    ]);
    const r = await runTriage(opts(dir, model));
    expect(r.byClass).toEqual({ 'app-bug': 2, env: 1 });
    const md = readFileSync(join(dir, 'e2e', '2026-09-30T12-34.md'), 'utf8');
    expect(md).toContain('participant opens a task');
    expect(md).toContain('fix env');
    const lines = readFileSync(join(dir, 'e2e.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      failures: 3,
      byClass: { 'app-bug': 2, env: 1 },
      tokens: { in: 300, out: 30, image: 0 },
    });
    const att = readFileSync(join(dir, 'ATTENTION.md'), 'utf8');
    expect(att).toContain('participant opens a task');
    expect(att).not.toContain('map shows markers');
    expect(att).not.toContain('sync after reload');
  });

  it('retries invalid JSON once, then class unknown', async () => {
    const dir = tmp();
    const model = fakeModel((t) =>
      t === 'participant opens a task'
        ? ['not json', answer('flaky', 'low')]
        : ['not json', '{"class":"bogus"}'],
    );
    const r = await runTriage(opts(dir, model));
    expect(r.byClass).toEqual({ flaky: 1, unknown: 2 });
    expect(model.calls).toHaveLength(6);
    expect(existsSync(join(dir, 'ATTENTION.md'))).toBe(false);
  });

  it('model unreachable: report with unknown, no throw', async () => {
    const dir = tmp();
    const r = await runTriage(
      opts(
        dir,
        fakeModel(() => new Error('ECONNREFUSED')),
      ),
    );
    expect(r.byClass).toEqual({ unknown: 3 });
    expect(readdirSync(join(dir, 'e2e'))).toHaveLength(1);
    expect(readFileSync(join(dir, 'e2e.jsonl'), 'utf8')).toContain('"unknown":3');
  });

  it('GPU busy past the timeout: no model call, unknown', async () => {
    const dir = tmp();
    const model = fakeModel(() => [answer('env', 'high')], false);
    const r = await runTriage(opts(dir, model));
    expect(model.calls).toHaveLength(0);
    expect(r.byClass).toEqual({ unknown: 3 });
  });

  it('sends the screenshot as an image and counts image tokens', async () => {
    const dir = tmp();
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(280, 16);
    png.writeUInt32BE(560, 20);
    const model = fakeModel(() => [answer('test-bug', 'low')]);
    const r = await runTriage({ ...opts(dir, model), readImage: () => png });
    expect(JSON.stringify(model.calls[0])).toContain('data:image/png;base64,');
    expect(r.tokens.image).toBe(3 * 10 * 20);
  });
});

describe('prompt size cap', () => {
  it('never exceeds the cap, even for a huge trace', () => {
    const huge = 'x'.repeat(5_000_000);
    const f = collectFailures(report)[0] as Failure;
    const trace = traceSummary(
      [
        ...Array.from({ length: 50_000 }, (_, i) =>
          JSON.stringify({ type: 'before', apiName: `click ${i}`, params: { selector: huge.slice(0, 50) } }),
        ),
        JSON.stringify({ type: 'frame-snapshot', snapshot: { html: [huge] } }),
      ].join('\n'),
      '',
    );
    expect(trace.length).toBeLessThan(MAX_PROMPT_CHARS);
    const prompt = buildPrompt({ ...f, error: huge, console: huge, network: huge, trace: huge });
    const text = prompt.map((m: { content: unknown }) => JSON.stringify(m.content)).join('');
    expect(text.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS + 2000);
  });

  it('summarises actions, console errors, failed requests and the last DOM snapshot', () => {
    const s = traceSummary(
      [
        JSON.stringify({ type: 'before', apiName: 'page.goto', params: { url: '/x' } }),
        JSON.stringify({ type: 'console', messageType: 'error', text: 'boom' }),
        JSON.stringify({ type: 'frame-snapshot', snapshot: { html: ['<div>dom</div>'] } }),
      ].join('\n'),
      JSON.stringify({
        type: 'resource-snapshot',
        snapshot: { request: { url: '/api/a' }, response: { status: 500 } },
      }),
    );
    expect(s).toContain('page.goto');
    expect(s).toContain('boom');
    expect(s).toContain('500 /api/a');
    expect(s).toContain('dom');
  });
});

describe('metrics report row', () => {
  it('builds the e2e triage cells from e2e.jsonl entries', () => {
    const cells = e2eRows([
      {
        failures: 3,
        byClass: { 'app-bug': 1, env: 2 },
        tokens: { in: 1000, out: 100, image: 500 },
        ms: 4000,
      },
      { failures: 0, byClass: {}, tokens: { in: 0, out: 0, image: 0 }, ms: 0 },
    ]);
    expect(cells.map((c: string[]) => c[0])).toEqual([
      'e2e triage runs',
      'failures classified',
      'local model tokens in / out / image',
      'model time',
    ]);
    expect(cells[0]?.[1]).toBe('2');
    expect(cells[1]?.[1]).toContain('app-bug 1');
    expect(cells[2]?.[1]).toBe('1.0k / 100 / 500');
  });
  it('handles no data', () => {
    expect(e2eRows([])).toEqual([]);
  });
});
