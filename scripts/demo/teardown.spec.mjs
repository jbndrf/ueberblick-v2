// WP-962: a failed case must not leave a server behind. stopChildren() kills by the pid the spec started
// (SIGINT, then SIGKILL after a grace period), waits for the exit and for the port to free, so the next case starts.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { freePort } from '../ui/seed.mjs';
import { stopChildren, waitPortFree } from './teardown.mjs';

const started = [];
// a stand-in for the demo: listens on the port; STUBBORN ignores SIGINT so only SIGKILL ends it
const SERVER = `
  const net = require('node:net');
  if (process.env.STUBBORN) process.on('SIGINT', () => {});
  const s = net.createServer().listen(Number(process.env.PORT), '127.0.0.1', () => console.log('READY'));
  s.on('error', (e) => { console.error(e.code); process.exit(3); });
`;

function serve(port, stubborn = false) {
  const child = spawn(process.execPath, ['-e', SERVER], {
    env: specEnv({ PORT: String(port), ...(stubborn ? { STUBBORN: '1' } : {}) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(child);
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => String(d).includes('READY') && resolve(undefined));
    void exited.then((code) => reject(new Error(`server exited ${code}`)));
  });
  return { child, ready };
}

const canBind = (port) =>
  new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });

afterEach(async () => {
  await stopChildren(started, { graceMs: 300 });
});
afterAll(() => {
  for (const c of started) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
});

describe('teardown of spec-started servers', () => {
  const port = {};
  it('case 1 leaves its server running, as a failed assertion would', async () => {
    port.n = await freePort();
    await serve(port.n).ready;
    expect(await canBind(port.n)).toBe(false);
  });

  it('case 2 starts on the same port: no EADDRINUSE, because afterEach stopped case 1', async () => {
    expect(started[0].exitCode !== null || started[0].signalCode !== null).toBe(true);
    await waitPortFree(port.n);
    await serve(port.n).ready;
    expect(await canBind(port.n)).toBe(false);
  });

  it('a server that ignores SIGINT is killed after the grace period', async () => {
    await waitPortFree(port.n);
    const run = serve(port.n, true);
    await run.ready;
    const t = Date.now();
    await stopChildren([run.child], { graceMs: 300 });
    expect(run.child.signalCode).toBe('SIGKILL');
    expect(Date.now() - t).toBeGreaterThanOrEqual(250);
    await waitPortFree(port.n);
    expect(await canBind(port.n)).toBe(true);
  });

  it('waitPortFree rejects when something keeps the port', async () => {
    const hold = createServer();
    const p = await freePort();
    await new Promise((r) => hold.listen(p, '127.0.0.1', r));
    await expect(waitPortFree(p, { timeoutMs: 300 })).rejects.toThrow(/still in use/);
    hold.close();
  });
});
