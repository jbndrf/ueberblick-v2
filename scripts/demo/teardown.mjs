// WP-962: stop servers a spec started, even after a failed assertion. By pid (the ChildProcess handle), never by
// name: SIGINT first (the demo and the web app shut down on it), SIGKILL after a grace period, then wait for the exit.
import { createServer } from 'node:net';

const running = (child) => child.exitCode === null && child.signalCode === null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops every child still running and resolves when all have exited. */
export async function stopChildren(children, { graceMs = 10_000 } = {}) {
  await Promise.all(
    children.filter(running).map(async (child) => {
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGINT');
      const timer = setTimeout(() => running(child) && child.kill('SIGKILL'), graceMs);
      await gone;
      clearTimeout(timer);
    }),
  );
}

/** Resolves when `port` on 127.0.0.1 can be bound; rejects after `timeoutMs`. */
export async function waitPortFree(port, { timeoutMs = 10_000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const free = await new Promise((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
    });
    if (free) return;
    if (Date.now() > until) throw new Error(`port ${port} is still in use after ${timeoutMs} ms`);
    await sleep(100);
  }
}
