// The scenarios: which page, what the runner does to it, and which budget each measurement meets.
// A driver returns [{label, budget, value}]. A new scenario (for example 3D, H1) is a folder under
// scenarios/ with its index.html plus one entry here; nothing else in the runner changes.
import { DOC_BUDGETS, defineBudget } from '../harness/budget.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INP = DOC_BUDGETS['interaction-to-next-paint'];
const LONG = DOC_BUDGETS['long-task'];

export const SHELL_FIRST_RENDER = defineBudget({
  id: 'shell-first-render',
  limit: 3000,
  unit: 'ms',
  derivedFrom: 'cold-start-60k: first render of the shell in the device profile (browser bench)',
  device: 'measured',
});
export const MAP_CLUSTER_BUILD = defineBudget({
  id: 'map-cluster-build',
  limit: 1500,
  unit: 'ms',
  derivedFrom: 'cold-start-60k: cluster build in the device profile (browser bench); 1500 ms per B-007',
  device: 'measured',
});
export const MAP_UPDATE_MAIN = defineBudget({
  id: 'map-update-main-thread',
  limit: 16,
  unit: 'ms',
  derivedFrom: 'long-task: one update on the main thread in the device profile (browser bench)',
  device: 'measured',
});

/** Renderer init is reported, not judged (B-007): judged on a real GPU. Listed in REPORT_ONLY_BUDGETS. */
export const MAP_RENDERER_INIT = defineBudget({
  id: 'map-renderer-init',
  limit: 100,
  unit: 'ms',
  derivedFrom: 'long-task: MapLibre module evaluation, GL context and first render (B-007)',
  device: 'measured',
});

/** WP-859: opening the Liste over 60k to its rows, judged against the warm-start row (3 s). */
export const LIST_TIME_TO_ROWS = defineBudget({
  id: 'list-time-to-rows-60k',
  limit: 3,
  unit: 's',
  derivedFrom: 'warm-start-map: the Liste of 60k features has its rows within the warm-start time (browser bench)',
  device: 'measured',
});

const settle = (s, ms = 600) => s.page.waitForTimeout(ms);

/** Diagnostics (WP-549): BENCH_PROFILE_DIR=<dir> writes a CPU profile of the click-to-paint window. */
async function profiled(s, name, act) {
  const dir = process.env.BENCH_PROFILE_DIR;
  if (dir === undefined) return act();
  await s.cdp.send('Profiler.enable');
  await s.cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await s.cdp.send('Profiler.start');
  const out = await act();
  const { profile } = await s.cdp.send('Profiler.stop');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}-${Date.now()}.cpuprofile`), JSON.stringify(profile));
  return out;
}

async function form(open, query) {
  const s = await open();
  await s.goto('form', query);
  await settle(s);
  const opened = await profiled(s, 'form-open', async () => {
    await s.page.click('#open');
    return s.metric('open');
  });
  await s.page.locator('input[type=text]').first().click();
  await s.page.keyboard.type('hello', { delay: 80 });
  await settle(s, 300);
  const keystroke = await s.metric('keystroke');
  await s.close();
  return [
    { label: 'open', budget: INP, value: opened },
    { label: 'keystroke', budget: INP, value: keystroke },
  ];
}

async function sheet(open, query) {
  const s = await open();
  await s.goto('sheet', query);
  await settle(s);
  await s.page.getByRole('button', { name: 'New task' }).click();
  const opened = await s.metric('open');
  await s.close();
  return [{ label: 'open', budget: INP, value: opened }];
}

async function taskSheet(open, query) {
  const s = await open();
  await s.goto('task-sheet', query);
  await settle(s);
  const opened = await profiled(s, 'task-sheet-open', async () => {
    await s.page.getByRole('button', { name: 'New task' }).click();
    return s.metric('open');
  });
  await s.close();
  return [{ label: 'open (50 fields)', budget: INP, value: opened }];
}

async function shell(open, query) {
  const s = await open();
  await s.goto('shell', query);
  const first = await s.metric('firstRender');
  const js = s.jsGzipKb();
  await s.close();
  return [
    { label: 'first render', budget: SHELL_FIRST_RENDER, value: first },
    { label: 'initial JS gzip', budget: DOC_BUDGETS['shell-js-gzip'], value: js },
  ];
}

/** Resolves once the map has finished another move (its `moveend` counter rose past `before`). */
async function nextMove(page, before) {
  await page.waitForFunction((n) => window.__bench.metrics.moves > n, before, { timeout: 15_000 });
}

const movesSoFar = (page) => page.evaluate(() => window.__bench.metrics.moves || 0);

/**
 * Real mouse input over the map: five drags, then wheel zoom in and out. Each input waits for its own
 * `moveend`. Fixed pauses were the flake (WP-539): under CPU x4 MapLibre's wheel easing and drag inertia
 * outlast a 350 ms gap, so consecutive wheel ticks merged into one move and only 6-7 moves were counted.
 */
async function panZoom(page) {
  const { width, height } = page.viewportSize() ?? { width: 412, height: 800 };
  const cx = width / 2;
  const cy = height / 2;
  for (const [dx, dy] of [
    [-120, 40],
    [90, 90],
    [60, -110],
    [-140, -30],
    [80, 20],
  ]) {
    const before = await movesSoFar(page);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
    await page.mouse.up();
    await nextMove(page, before);
  }
  for (const delta of [-300, -300, -300, -300, 300, 300, 300, 300]) {
    const before = await movesSoFar(page);
    await page.mouse.wheel(0, delta);
    await nextMove(page, before);
  }
  await page.waitForTimeout(1000);
}

/** Diagnostics (WP-541): BENCH_PROFILE_DIR=<dir> writes a CPU profile and the long tasks of the pan/zoom phase. */
async function saveProfile(s, dir, from) {
  const { profile } = await s.cdp.send('Profiler.stop');
  const stoppedAt = await s.now();
  const tasks = await s.page.evaluate(() => window.__bench.longtasks);
  mkdirSync(dir, { recursive: true });
  const name = `panzoom-${Date.now()}`;
  writeFileSync(join(dir, `${name}.cpuprofile`), JSON.stringify(profile));
  writeFileSync(
    join(dir, `${name}.tasks.json`),
    JSON.stringify({ from, stoppedAt, tasks: tasks.filter((t) => t.start >= from) }),
  );
}

const secs = (ms) => ms / 1000;

async function map(open, query) {
  const s = await open();
  await s.goto('map', query);
  await s.page.evaluate(() => window.__bench.begin?.());
  await s.metric('firstMarkers', 60_000);
  await settle(s, 1500);
  const m = await s.metrics();
  const cold = secs(m.firstMarkers - m.generate);
  // B-007: renderer init (MapLibre module evaluation, GL context, first render) ends when the map
  // subscribes to features; long tasks after that are feature delivery and are enforced.
  const initLong = await s.maxLongTask(m.beginAt, m.subscribeAt);
  const loadLong = await s.maxLongTask(m.subscribeAt, m.firstMarkers + 1000);

  const t1 = await s.now();
  const profile = process.env.BENCH_PROFILE_DIR;
  if (profile !== undefined) {
    await s.cdp.send('Profiler.enable');
    await s.cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    await s.cdp.send('Profiler.start');
  }
  await panZoom(s.page);
  if (profile !== undefined) await saveProfile(s, profile, t1);
  const panLong = await s.maxLongTask(t1);
  const moves = (await s.metrics()).moves;
  // The input must have moved the map, or the long-task figure would prove nothing.
  if (query === '' && !(moves >= 8)) throw new Error(`pan/zoom moved the map only ${moves} times`);
  const heap = await s.heapMb();

  await s.page.evaluate(() => window.benchUpdate());
  const delta = await s.metric('deltaVisible');
  const updateMain = (await s.metrics()).updateMain;

  await s.goto('map', query); // same context: the browser cache is warm
  await s.page.evaluate(() => window.__bench.begin?.());
  await s.metric('firstMarkers', 60_000);
  const w = await s.metrics();
  const warm = secs(w.firstMarkers - w.generate);
  await s.close();
  return [
    { label: 'cold start to first markers', budget: DOC_BUDGETS['cold-start-60k'], value: cold },
    { label: 'warm start to markers', budget: DOC_BUDGETS['warm-start-map'], value: warm },
    { label: 'cluster build (worker)', budget: MAP_CLUSTER_BUILD, value: m.clusterBuild },
    { label: 'longest task, feature delivery', budget: LONG, value: loadLong },
    { label: 'longest task, renderer init', budget: MAP_RENDERER_INIT, value: initLong, reportOnly: true },
    { label: 'longest task, pan/zoom', budget: LONG, value: panLong },
    {
      label: 'longest task, pan/zoom, single-run max',
      budget: LONG,
      value: panLong,
      aggregate: 'max',
      info: true,
    },
    { label: 'JS heap, 60k', budget: DOC_BUDGETS['heap-60k'], value: heap },
    {
      scenario: 'one-feature-update',
      label: 'delta visible',
      budget: DOC_BUDGETS['delta-visible'],
      value: secs(delta),
    },
    { scenario: 'one-feature-update', label: 'main thread', budget: MAP_UPDATE_MAIN, value: updateMain },
  ];
}

/** WP-560: a 60k-feature snapshot (60 pages of 1,000) pulled through the real sync worker into an empty store on real IndexedDB. */
async function syncSnapshot(open, query) {
  const s = await open();
  // WP-567: BENCH_SYNC_HOST=inthread runs the pipeline on the main thread (the WP-565 baseline); default is the worker.
  const host = process.env.BENCH_SYNC_HOST ?? 'worker';
  await s.goto('sync', `${query === '' ? '?' : `${query}&`}host=${host}`);
  await profiled(s, 'sync-snapshot', async () => {
    await s.page.evaluate(() => window.__bench.begin?.());
    try {
      await s.metric('copyDone', 120_000);
    } catch (e) {
      const errors = await s.page.evaluate(() => window.__bench.errors);
      throw new Error(`the snapshot did not finish: ${errors.join('; ') || e}`);
    }
  });
  await settle(s, 500);
  const m = await s.metrics();
  if (query === '' && !(m.pages === 60 && m.features === 60_000))
    throw new Error(`copied ${m.features} features in ${m.pages} pages`);
  const longest = await s.maxLongTask(m.beginAt);
  const heap = await s.heapMb();
  if (process.env.BENCH_PROFILE_DIR !== undefined) {
    const tasks = await s.page.evaluate(() => window.__bench.longtasks);
    console.log(
      'long tasks (start, ms):',
      tasks.map((t) => `${Math.round(t.start - m.beginAt)}:${Math.round(t.duration)}`).join(' '),
    );
  }
  console.log(`sync-snapshot-60k info: host ${host}, copy ${Math.round(m.copyMs)} ms`);
  await s.close();
  return [
    { label: 'longest task per page', budget: LONG, value: longest },
    { label: 'total offline copy', budget: DOC_BUDGETS['offline-copy-60k'], value: secs(m.copyMs) },
    { label: 'JS heap, 60k copied', budget: DOC_BUDGETS['heap-60k'], value: heap },
  ];
}

/** WP-859: the Liste's chunked read at 60k trees (real view source, MemoryIndex), and a filter change with one relation hop. */
async function listOpen(open, query) {
  const s = await open();
  await s.goto('list', query);
  await s.page.evaluate(() => window.__bench.begin?.());
  await s.metric('listRows', 120_000);
  await s.metric('listPainted', 120_000);
  const m = await s.metrics();
  if (query === '' && !(m.rows > 1000)) throw new Error(`the Liste read ${m.rows} rows`);
  const longest = await s.maxLongTask(m.beginAt, m.listRows + 100);
  const render = await s.maxLongTask(m.listRows);
  const heap = await s.heapMb();
  console.log(`list-60k info: ${m.rows} rows, read ${Math.round(m.listRows - m.beginAt)} ms, painted after ${Math.round(m.listPainted - m.beginAt)} ms (x4 profile)`);
  await s.close();
  return [
    { label: 'open Liste to rows painted', budget: LIST_TIME_TO_ROWS, value: secs(m.listPainted - m.beginAt) },
    { label: 'longest task, Liste read', budget: LONG, value: longest },
    { label: 'longest task, Liste render', budget: LONG, value: render },
    { label: 'JS heap, Liste of 48k rows', budget: DOC_BUDGETS['heap-60k'], value: heap },
  ];
}

async function filterChange(open, query) {
  const s = await open();
  await s.goto('list', query);
  await s.page.evaluate(() => window.benchFilter());
  const m = await s.metrics();
  if (query === '' && !(m.rows > 1000)) throw new Error(`the filter pass delivered ${m.rows} rows`);
  const longest = await s.maxLongTask(m.filterAt, m.filterDone + 100);
  console.log(`filter-change-60k info: ${m.rows} rows hidden and shown again in ${Math.round(m.filterDone - m.filterAt)} ms`);
  await s.close();
  return [{ label: 'longest task, filter change (one hop)', budget: DOC_BUDGETS['filter-change-60k'], value: longest }];
}

export const SCENARIOS = [
  { id: 'form-50-fields', page: 'form', run: form },
  { id: 'task-sheet', page: 'sheet', run: sheet },
  { id: 'task-sheet-50', page: 'task-sheet', run: taskSheet },
  { id: 'shell', page: 'shell', run: shell },
  { id: 'map-60k', page: 'map', run: map },
  { id: 'sync-snapshot-60k', page: 'sync', run: syncSnapshot },
  { id: 'list-60k', page: 'list', run: listOpen },
  { id: 'filter-change-60k', page: 'list', run: filterChange },
];
