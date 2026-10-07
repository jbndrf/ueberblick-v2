// Launches headless Chromium with the reference device profile (docs/12) and wraps one page session.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { ensureLibs } from './libs.mjs';

/** Reference device (docs/12): CPU x4 and Fast 4G. Throughput in bytes per second, latency in ms. */
export const PROFILE = Object.freeze({
  cpuRate: 4,
  network: {
    latency: 60,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (1.5 * 1024 * 1024) / 8,
  },
  viewport: { width: 412, height: 800 },
});

function findExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), '.cache', 'ms-playwright');
  const find = () =>
    existsSync(root)
      ? readdirSync(root)
          .filter((d) => d.startsWith('chromium_headless_shell-'))
          .sort()
          .map((d) => join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))
          .filter(existsSync)
          .pop()
      : undefined;
  let exe = find();
  if (exe === undefined) {
    console.log('browser setup: installing chromium-headless-shell');
    execFileSync('npx', ['playwright-core', 'install', 'chromium-headless-shell'], { stdio: 'inherit' });
    exe = find();
  }
  if (exe === undefined)
    throw new Error('chromium-headless-shell is not installed and could not be installed');
  return exe;
}

/** Software GL (SwiftShader): the GPU of a phone is not measured, only main-thread and worker work. */
export async function launch() {
  const exe = findExecutable();
  const env = { ...process.env, ...ensureLibs(exe) };
  return chromium.launch({
    executablePath: exe,
    env,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
}

/** One fresh context (empty cache) with CPU and network throttling. */
export async function openSession(browser, base) {
  const context = await browser.newContext({ viewport: PROFILE.viewport, hasTouch: false });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: PROFILE.cpuRate });
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILE.network });
  await cdp.send('Performance.enable');
  const urls = new Map();
  let jsBytes = 0;
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
  cdp.on('Network.loadingFinished', (e) => {
    if (/\.js(\?|$)/.test(urls.get(e.requestId) ?? '')) jsBytes += e.encodedDataLength;
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const s = {
    page,
    cdp,
    pageErrors,
    /** Navigates and waits for the scenario's `ready` flag. */
    async goto(name, query = '') {
      jsBytes = 0;
      await page.goto(`${base}/${name}/index.html${query}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__bench?.ready === true, undefined, { timeout: 60_000 });
    },
    /** Waits until a named in-page metric is a number. */
    async metric(key, timeout = 30_000) {
      await page.waitForFunction((k) => Number.isFinite(window.__bench.metrics[k]), key, { timeout });
      return page.evaluate((k) => window.__bench.metrics[k], key);
    },
    metrics: () => page.evaluate(() => ({ ...window.__bench.metrics })),
    now: () => page.evaluate(() => performance.now()),
    /** Longest main-thread task that started in [from, to] (page clock, ms); 0 when there was none. */
    async maxLongTask(from, to = Number.POSITIVE_INFINITY) {
      const tasks = await page.evaluate(() => window.__bench.longtasks);
      return Math.max(0, ...tasks.filter((t) => t.start >= from && t.start <= to).map((t) => t.duration));
    },
    jsGzipKb: () => jsBytes / 1024,
    /** Used JS heap of the page in MB after a forced GC. Workers are separate and not included. */
    async heapMb() {
      await cdp.send('HeapProfiler.enable');
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      return (metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? Number.NaN) / (1024 * 1024);
    },
    close: () => context.close(),
  };
  return s;
}
