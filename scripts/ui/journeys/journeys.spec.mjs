// WP-902: the journey runner with a fake model and a fake ui port, the candidate step and the outputs.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeCandidate } from './candidate.mjs';
import { JOURNEYS } from './defs.mjs';
import { writeOutputs } from './output.mjs';
import { BUDGET, MODEL_TOOLS, runJourney } from './runner.mjs';

const APP = 'http://127.0.0.1:40000';
const def = { ...JOURNEYS[0], maxActions: 6 };
const say = (o) => ({ text: JSON.stringify(o), ms: 10, usage: { input: 100, output: 20 } });

/** A fake ui port that appends to a fake action log exactly like ui.mjs does. */
function fakeUi() {
  const log = [];
  const calls = [];
  const ui = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'seed') {
      log.push({ cmd, locator: null, args, url: 'about:blank' });
      return Promise.resolve({ ok: true, text: 'seeded', data: { url: APP } });
    }
    if (cmd === 'open') {
      log.push({ cmd, locator: null, args, url: args[0] });
      return Promise.resolve({ ok: true, text: 'opened' });
    }
    if (cmd === 'snapshot')
      return Promise.resolve({ ok: true, text: `url: ${APP}\n- button "Outline" [e1]` });
    if (cmd === 'click') {
      if (args[0] === 'e99') return Promise.resolve({ ok: false, error: 'e99 is gone' });
      log.push({ cmd, locator: { role: 'button', name: 'Outline' }, args: [], url: `${APP}/builder` });
      return Promise.resolve({ ok: true, text: 'click e1' });
    }
    if (cmd === 'screenshot')
      return Promise.resolve({ ok: true, text: '/x/001.png', data: { path: '/x/001.png' } });
    return Promise.resolve({ ok: true, text: cmd });
  };
  return { ui, log, calls };
}

function run(replies, { budget, now } = {}) {
  const f = fakeUi();
  let i = 0;
  const seen = [];
  const model = {
    chat: (messages) => {
      seen.push(messages);
      const r = replies[Math.min(i++, replies.length - 1)];
      return Promise.resolve(typeof r === 'function' ? r() : r);
    },
  };
  let t = 0;
  const p = runJourney({
    def,
    docsText: 'doc',
    model,
    ui: f.ui,
    readActions: () => f.log,
    readShot: () => null,
    now: now ?? (() => (t += 1000)),
    budget,
  });
  return { p, f, seen };
}

describe('runJourney with a fake model', () => {
  it('records steps from the action log, not from what the model says', async () => {
    const { p } = run([
      say({
        action: 'click',
        args: ['e1'],
        note: 'I will click Save and type hello',
        expect: { role: 'button', name: 'Outline', visible: true },
      }),
      say({ action: 'finish', verdict: 'passes', findings: [] }),
    ]);
    const r = await p;
    expect(r.verdict).toBe('passes');
    expect(r.steps.map((s) => s.cmd)).toEqual(['seed', 'open', 'click']); // nothing the model only claimed
    expect(r.steps[2]).toMatchObject({ n: 3, locator: { role: 'button', name: 'Outline' } });
    expect(r.steps[1].args).toEqual([`${APP}${def.startPath}`]);
    expect(r.expectations).toEqual([
      { after: 3, expect: { role: 'button', name: 'Outline', visible: true } },
    ]);
    expect(r.stats.calls).toBe(2);
  });

  it('records an expectation once per step even when the model repeats it', async () => {
    const same = { role: 'button', name: 'Outline', visible: true };
    const r = await run([
      say({ action: 'snapshot', expect: [same, same] }),
      say({ action: 'snapshot', expect: same }),
      say({ action: 'finish', verdict: 'passes' }),
    ]).p;
    expect(r.expectations).toEqual([{ after: 2, expect: same }]);
  });

  it('the model budget ends the journey as blocked-at <step>, no retry loop', async () => {
    const { p, seen } = run([say({ action: 'snapshot' })], { budget: { calls: 4, ms: BUDGET.ms } });
    const r = await p;
    expect(r.verdict).toBe('blocked-at 3'); // seed, open logged: the next step is the third
    expect(r.stats.calls).toBe(4);
    expect(seen).toHaveLength(4);
    expect(r.notes.join()).toContain('4 model calls');
  });

  it('the time budget and the action cap also give blocked-at', async () => {
    let t = 0;
    const timed = run([say({ action: 'snapshot' })], { now: () => (t += BUDGET.ms / 2) });
    expect((await timed.p).verdict).toMatch(/^blocked-at \d+$/);
    const capped = run([say({ action: 'click', args: ['e1'] })]);
    const r = await capped.p;
    expect(r.verdict).toBe('blocked-at 9'); // 2 setup + 6 clicks logged, the next would be the 9th
    expect(r.stats.actions).toBe(8);
  });

  it('the default budget is 40 calls and 15 minutes', () => {
    expect(BUDGET).toEqual({ calls: 40, ms: 900_000 });
  });

  it('bad replies and unknown tools cost a call but never reach ui.mjs; errors are fed back', async () => {
    const { p, f, seen } = run([
      { text: 'sorry, I think I should click', ms: 1, usage: { input: 1, output: 1 } },
      say({ action: 'hover', args: ['e1'] }),
      say({ action: 'open', args: ['http://elsewhere'] }), // the runner owns open
      say({ action: 'click', args: ['e99'] }),
      say({ action: 'finish', verdict: 'nonsense' }),
      say({
        action: 'finish',
        verdict: 'ux-issue',
        findings: [{ severity: 'high', text: 'x' }, { severity: 'bogus', text: 'y' }, 3],
      }),
    ]);
    const r = await p;
    expect(r.verdict).toBe('ux-issue');
    expect(r.findings).toEqual([{ severity: 'high', text: 'x' }]);
    expect(f.calls.filter((c) => c[0] === 'hover' || c[1] === 'http://elsewhere')).toEqual([]);
    const last = seen
      .at(-1)
      .map((m) => m.content)
      .join('\n');
    expect(last).toContain('error: e99 is gone');
    expect(last).toContain('Unknown action "hover"');
    expect(r.expectations).toEqual([]);
  });

  it('a model that answers finish with blocked gives blocked-at; a failing model port too', async () => {
    const a = run([say({ action: 'finish', verdict: 'blocked', findings: [] })]);
    expect((await a.p).verdict).toBe('blocked-at 3');
    const b = run([() => Promise.reject(new Error('GPU gone'))]);
    const r = await b.p;
    expect(r.verdict).toBe('blocked-at 3');
    expect(r.notes.join()).toContain('GPU gone');
  });

  it('keeps only the newest snapshot in the context and ignores malformed expectations', async () => {
    const { p, seen } = run([
      say({ action: 'snapshot' }),
      say({ action: 'snapshot', expect: { visible: true } }),
      say({ action: 'snapshot' }),
      say({ action: 'finish', verdict: 'passes' }),
    ]);
    const r = await p;
    const users = seen
      .at(-1)
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(users.filter((c) => c.startsWith('url:'))).toHaveLength(1);
    expect(users.filter((c) => c === '[earlier snapshot elided]')).toHaveLength(3);
    expect(r.expectations).toEqual([]);
    expect(r.notes.join()).toContain('ignored expectation');
  });

  it('offers the model exactly the ui.mjs tools without seed, open, stop and help', () => {
    expect(MODEL_TOOLS.map((c) => c.name).sort()).toEqual(
      [
        'axe',
        'click',
        'console',
        'fill',
        'network',
        'press',
        'screenshot',
        'select',
        'snapshot',
        'wait',
      ].sort(),
    );
  });
});

describe('makeCandidate', () => {
  const doc = {
    journey: 'demo',
    title: 'Demo',
    viewport: null,
    steps: [
      { n: 1, cmd: 'seed', locator: null, args: ['musterstadt-baeume'] },
      { n: 2, cmd: 'open', locator: null, args: [`${APP}/builder/x`] },
      { n: 3, cmd: 'click', locator: { role: 'button', name: 'Outline' }, args: [] },
    ],
    expectations: [{ after: 3, expect: { text: 'Outline' } }],
  };
  const tmp = () => mkdtempSync(join(tmpdir(), 'cand-'));

  it('3 of 3 passes is ready and the spec keeps its name', () => {
    const dir = tmp();
    const r = makeCandidate({ doc, dir, run: () => ({ passes: 3, runs: 3 }) });
    expect(r.status).toBe('ready');
    expect(readFileSync(join(dir, 'demo.spec.ts'), 'utf8')).toContain('// candidate: ready');
  });

  it("anything less is unstable, with the failure attached, and out of Playwright's reach", () => {
    const dir = tmp();
    const r = makeCandidate({ doc, dir, run: () => ({ passes: 2, runs: 3, failure: 'Timeout 5000ms' }) });
    expect(r.status).toBe('unstable');
    expect(existsSync(join(dir, 'demo.spec.ts'))).toBe(false);
    expect(readFileSync(join(dir, 'demo.unstable.ts'), 'utf8')).toMatch(
      /candidate: unstable \(2\/3 passes; Timeout 5000ms\)/,
    );
  });

  it('without an expectation there is no candidate and nothing runs', () => {
    let ran = false;
    const r = makeCandidate({
      doc: { ...doc, expectations: [] },
      dir: tmp(),
      run: () => ((ran = true), { passes: 3, runs: 3 }),
    });
    expect(r.status).toBe('none');
    expect(ran).toBe(false);
  });

  it('a step without a stable locator makes it unstable even when it passes', () => {
    const steps = [...doc.steps, { n: 4, cmd: 'click', locator: null, args: [] }];
    const r = makeCandidate({ doc: { ...doc, steps }, dir: tmp(), run: () => ({ passes: 3, runs: 3 }) });
    expect(r.status).toBe('unstable');
    expect(r.detail).toContain('without a stable locator');
  });
});

describe('writeOutputs', () => {
  it('writes the md, the steps.json and a metrics line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'out-'));
    const raw = mkdtempSync(join(tmpdir(), 'raw-'));
    const result = {
      verdict: 'docs-mismatch',
      findings: [{ severity: 'high', text: 'The path is missing' }],
      steps: [{ n: 1, cmd: 'seed', locator: null, args: ['f'], url: 'about:blank' }],
      expectations: [],
      notes: [],
      shots: [],
      stats: { calls: 3, in: 10, out: 5, image: 0, ms: 50, screenshots: 0, actions: 1 },
    };
    writeOutputs({ def, result, candidate: { status: 'none', detail: 'x' }, dir, rawDir: raw });
    expect(readFileSync(join(dir, `${def.id}.md`), 'utf8')).toContain('verdict: **docs-mismatch**');
    expect(JSON.parse(readFileSync(join(dir, `${def.id}.steps.json`), 'utf8')).steps).toHaveLength(1);
    const line = JSON.parse(readFileSync(join(raw, 'journeys.jsonl'), 'utf8').trim());
    expect(line).toMatchObject({
      journey: def.id,
      verdict: 'docs-mismatch',
      candidate: 'none',
      findings: 1,
      high: 1,
      calls: 3,
    });
    expect(readFileSync(join(raw, 'ATTENTION.md'), 'utf8')).toContain('The path is missing');
  });
});

describe('journeysRows', () => {
  it('is empty without entries and counts verdicts and candidates', async () => {
    const { journeysRows } = await import('../../metrics/journeys-rows.mjs');
    expect(journeysRows([])).toEqual([]);
    const e = {
      calls: 5,
      actions: 3,
      screenshots: 1,
      findings: 1,
      high: 0,
      tokens: { in: 10, out: 1, image: 2 },
      ms: 1000,
      accepted: null,
    };
    const rows = Object.fromEntries(
      journeysRows([
        { ...e, verdict: 'passes', candidate: 'ready' },
        { ...e, verdict: 'blocked-at', candidate: 'none' },
      ]),
    );
    expect(rows['journeys run']).toBe('2');
    expect(rows['verdicts']).toBe('passes 1, blocked-at 1');
    expect(rows['candidates ready / unstable']).toBe('1 / 0');
  });
});
