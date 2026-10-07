// The detached session server: holds one Chromium page, answers POST /cmd from the CLI, exits on stop or
// after UI_IDLE_MS (default 15 min) without a request. Started by ui.mjs, not by hand.
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { COMMANDS, VIEWPORTS } from './commands.mjs';
import { clearSession, newRunDir, writeSession } from './state.mjs';

const IDLE_MS = Number(process.env.UI_IDLE_MS ?? 15 * 60_000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORTS['1280x800'] });
const session = {
  page,
  runDir: newRunDir(),
  nodes: [],
  consoleLog: [],
  netLog: [],
  shots: 0,
  app: undefined,
};

page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) session.consoleLog.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => session.consoleLog.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400) session.netLog.push(`${r.status()} ${r.request().method()} ${r.url()}`);
});
page.on('requestfailed', (r) =>
  session.netLog.push(`failed ${r.method()} ${r.url()}: ${r.failure()?.errorText}`),
);

let idle;
let queue = Promise.resolve();
let closing = false;

async function shutdown() {
  if (closing) return;
  closing = true;
  clearSession();
  session.app?.kill();
  await browser.close().catch(() => undefined);
  http.close();
  process.exit(0);
}

function resetIdle() {
  clearTimeout(idle);
  idle = setTimeout(shutdown, IDLE_MS);
}

async function handle({ cmd, args, flags }) {
  const command = COMMANDS.find((c) => c.name === cmd);
  if (command === undefined) return { ok: false, error: `unknown command ${cmd}` };
  try {
    return { ok: true, ...(await command.run(session, args ?? [], flags ?? {})) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).split('\n')[0] };
  }
}

const http = createServer((req, res) => {
  resetIdle();
  if (req.method === 'GET') {
    res.end('ok');
    return;
  }
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const job = queue.then(() => handle(JSON.parse(body)));
    queue = job.catch(() => undefined);
    void job.then((out) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(out), () => {
        if (out.ok && JSON.parse(body).cmd === 'stop') void shutdown();
      });
    });
  });
});

http.listen(0, '127.0.0.1', () => {
  writeSession({ port: http.address().port, pid: process.pid, runDir: session.runDir });
  resetIdle();
});
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
