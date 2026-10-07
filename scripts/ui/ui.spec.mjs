// WP-900: ui.mjs against a static fixture page. Every CLI call is a separate process, so the session
// survival test is also the normal path. Skipped (with a message) when Chromium cannot start.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { BUILD_COMMAND, isStale } from '../ops/web-build.mjs';

const UI = fileURLToPath(new URL('./ui.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

async function canLaunch() {
  try {
    await (await chromium.launch()).close();
    return true;
  } catch (e) {
    console.warn(`ui.mjs tests skipped: Chromium cannot start (${String(e.message).split('\n')[0]})`);
    return false;
  }
}
const available = await canLaunch();

let stateDir;
let runDir;
let site;
let base;
const env = () =>
  specEnv({
    UI_STATE_DIR: stateDir,
    UI_RUN_DIR: runDir,
    UI_IDLE_MS: process.env.TEST_IDLE_MS ?? '600000',
  });

function ui(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [UI, ...args], { env: env(), timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, out: stdout.trim(), err: stderr.trim() }),
    );
  });
}
const refOf = (snapshot, pattern) => {
  const line = snapshot.split('\n').find((l) => new RegExp(pattern).test(l));
  return /\[(e\d+)\]/.exec(line ?? '')?.[1];
};
/** Alive and not a zombie (a stopped session server can linger as one until init reaps it). */
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch {
    return false;
  }
}
const actions = () =>
  readFileSync(join(runDir, 'actions.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

beforeAll(async () => {
  if (!available) return;
  stateDir = mkdtempSync(join(tmpdir(), 'ui-state-'));
  runDir = join(stateDir, 'run');
  site = createServer((req, res) => {
    const name = req.url === '/' ? 'form.html' : req.url.slice(1);
    if (name === 'large.html') {
      const items = Array.from({ length: 3000 }, (_, i) => `<button>Item number ${i}</button>`);
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><title>large</title><main>${items.join('')}</main>`);
      return;
    }
    if (!/^[\w.-]+\.html$/.test(name) || !existsSync(join(FIXTURES, name))) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(readFileSync(join(FIXTURES, name)));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${site.address().port}`;
});

afterAll(async () => {
  if (!available) return;
  await ui('stop');
  site.close();
  rmSync(stateDir, { recursive: true, force: true });
});

describe.skipIf(!available)('ui.mjs', { timeout: 60_000 }, () => {
  let snap;

  it('open starts the session and loads the page', async () => {
    const r = await ui('open', base, '--viewport', '360x800');
    expect(r.code).toBe(0);
    expect(r.out).toContain('HTTP 200');
  });

  it('snapshot lists interactive and landmark nodes with refs', async () => {
    const r = await ui('snapshot');
    snap = r.out;
    expect(snap).toContain('- heading "Fixture page" [e');
    expect(snap).toContain('- navigation "Main"');
    expect(snap).toContain('- button "Save"');
    expect(snap).toContain('testid=icon-only');
    const json = JSON.parse((await ui('snapshot', '--json')).out);
    expect(json.ok).toBe(true);
    expect(json.data.truncated).toBe(false);
  });

  it('fill, click, select, press and wait act on the page', async () => {
    snap = (await ui('snapshot')).out;
    expect((await ui('fill', refOf(snap, 'textbox "Your name"'), 'Ada')).code).toBe(0);
    expect((await ui('select', refOf(snap, 'combobox "Kind"'), 'Beta')).code).toBe(0);
    expect((await ui('click', refOf(snap, 'button "Save"'))).code).toBe(0);
    expect((await ui('wait', 'saved Ada')).code).toBe(0);
    expect((await ui('press', 'Enter')).code).toBe(0);
    expect((await ui('wait', 'enter pressed')).code).toBe(0);
    expect((await ui('click', refOf(snap, 'button "Reveal"'))).code).toBe(0);
    expect((await ui('wait', 'Late arrival')).code).toBe(0);
    const again = (await ui('snapshot')).out;
    expect(again).toContain('value="Ada"');
    expect(again).toContain('value="Beta"');
  });

  it('screenshot writes a PNG', async () => {
    const r = await ui('screenshot');
    expect(r.out.endsWith('.png')).toBe(true);
    expect(readFileSync(r.out).subarray(1, 4).toString()).toBe('PNG');
    expect((await ui('screenshot', '--full')).code).toBe(0);
  });

  it('console reports the planted error, then reports nothing new', async () => {
    await ui('open', base);
    expect((await ui('console')).out).toContain('planted console error');
    expect((await ui('console')).out).toBe('no console errors or warnings');
  });

  it('network reports the 404', async () => {
    // The network log is drained by each read, so a repeat needs its own page load to have a 404 to report.
    await ui('open', base);
    const r = await ui('network');
    expect(r.out).toMatch(/404 GET .*\/missing\.png/);
  });

  it('axe reports the planted violation (an image without alt text)', async () => {
    const r = await ui('axe');
    expect(r.out).toMatch(/image-alt/);
  });

  it('logs role+name, testid, and null with a warning, and never CSS or XPath', async () => {
    const s = (await ui('snapshot')).out;
    await ui('click', refOf(s, 'testid=icon-only'));
    const anon = await ui('fill', refOf(s, 'textbox \\[e'), 'x');
    expect(anon.out).toContain('warning:');
    const log = actions();
    const save = log.find((a) => a.cmd === 'click' && a.locator?.name === 'Save');
    expect(save.locator).toEqual({ role: 'button', name: 'Save' });
    expect(log.find((a) => a.locator?.testid === 'icon-only').locator).toEqual({ testid: 'icon-only' });
    const nulled = log.find((a) => a.cmd === 'fill' && a.locator === null);
    expect(nulled.args).toEqual(['x']);
    for (const a of log)
      expect(Object.keys(a).sort()).toEqual(['args', 'at', 'cmd', 'locator', 'ref', 'url']);
    const raw = readFileSync(join(runDir, 'actions.jsonl'), 'utf8');
    expect(raw).not.toMatch(/data-ui-ref|xpath|\/\/\*|css/i);
    expect(raw).not.toMatch(/\[[a-z-]+=|#\w|\.\w+ >/);
  });

  it('keeps the session across separate processes and ends it on stop', async () => {
    // This test ends the session, so a repeat starts its own.
    await ui('open', base);
    const before = JSON.parse(readFileSync(join(stateDir, 'session.json'), 'utf8'));
    const r = await ui('snapshot');
    expect(r.out).toContain('Fixture page');
    expect(JSON.parse(readFileSync(join(stateDir, 'session.json'), 'utf8')).pid).toBe(before.pid);
    expect((await ui('stop')).out).toBe('stopped');
    expect(existsSync(join(stateDir, 'session.json'))).toBe(false);
    await vi.waitFor(() => expect(alive(before.pid)).toBe(false), { timeout: 10_000 });
    expect((await ui('stop')).out).toBe('no session running');
  });

  it('an unknown ref and an unknown command fail with a clear message', async () => {
    await ui('open', base);
    expect((await ui('click', 'e9999')).out).toMatch(/error: e9999 is gone|error: .*snapshot/);
    expect((await ui('nope')).code).toBe(2);
    await ui('stop');
  });

  it('snapshot stays under the size cap on a large page and says it truncated', async () => {
    await ui('open', `${base}/large.html`);
    const r = await ui('snapshot');
    expect(r.out.length).toBeLessThan(16_500);
    expect(r.out).toMatch(/\[truncated: \d+ of 3001 nodes shown/);
    expect(JSON.parse((await ui('snapshot', '--json')).out).data.truncated).toBe(true);
    await ui('stop');
  });

  const built = !isStale();
  if (!built) console.warn(`ui.mjs seed test skipped: the web build is missing or stale (${BUILD_COMMAND})`);
  it.skipIf(!built)(
    'seed gives a fresh project on a local port, for overlays of two base templates',
    async () => {
      // seed keeps its data in <run dir>/data-N and N restarts with every session, so a repeat needs its own run dir.
      runDir = mkdtempSync(join(stateDir, 'run-seed-'));
      try {
        for (const fixture of ['musterstadt-baeume', 'stadtwerke-meldungen']) {
          const r = JSON.parse((await ui('seed', fixture, '--json')).out);
          expect(r.ok).toBe(true);
          expect((await fetch(`${r.data.url}/api/health`)).ok).toBe(true);
        }
        expect((await ui('seed', 'no-such-fixture')).out).toMatch(/error: no fixture/);
      } finally {
        // a failed assertion must not leave the seeded app running (WP-962)
        await ui('stop');
      }
    },
  );

  it('exits by itself after the idle timeout', async () => {
    process.env.TEST_IDLE_MS = '1500';
    await ui('open', base);
    const { pid } = JSON.parse(readFileSync(join(stateDir, 'session.json'), 'utf8'));
    const until = Date.now() + 15_000;
    while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    delete process.env.TEST_IDLE_MS;
    expect(alive(pid)).toBe(false);
    expect(existsSync(join(stateDir, 'session.json'))).toBe(false);
  });
});
