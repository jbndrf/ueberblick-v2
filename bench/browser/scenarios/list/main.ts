// Scenario list-60k (WP-859): over 60k trees (a) opening the Liste: `begin()` runs the Liste's chunked read exactly as
// MapCanvas does (slices of `rowChunks`, a yield to the main thread between them, rename and keep) and `listRows` is
// the time until the rows are there; (b) a filter change with one relation hop: `benchFilter()` hides and shows the
// Objektart through the real `filteredSource`, whose reapply walks in slices; the runner reads the longest task.
import { mount } from 'svelte';
import { groupRows } from '../../../../apps/web/src/lib/participant/list/groups';
import ListView from '../../../../apps/web/src/lib/participant/list/ListView.svelte';
import { afterPaint } from '../../lib/probe';
import { filteredSource } from '../../../../apps/web/src/lib/participant/sheets/filter/filtered-source';
import { createFilterController } from '../../../../apps/web/src/lib/participant/sheets/filter/filter-controller';
import { createChunkedReader } from '../../../../apps/web/src/lib/participant/list/chunked-read';
import type { Key } from '@ueberblick/core/model';
import { EVERYWHERE, HOP, PLAIN, configWith, listOf, sourceOf, world } from '../../lib/list-world';
import { installProbe, slowdown } from '../../lib/probe';

const bench = installProbe();
const m = bench.metrics;
for (const k of ['generate', 'beginAt', 'listRows', 'rows', 'filterAt', 'listPainted', 'filterDone', 'shown']) m[k] = Number.NaN;

const g0 = performance.now();
const mem = world(60_000);
const config = configWith(HOP);
const plain = configWith(PLAIN);
m['generate'] = performance.now() - g0;

bench.begin = () => {
  m['beginAt'] = performance.now();
  slowdown();
  const list = listOf(mem, plain);
  void createChunkedReader()
    .read(list.rowChunks(undefined), (slice) => list.rename(slice, ['de']))
    .then((rows) => {
      m['rows'] = rows?.length ?? Number.NaN;
      m['listRows'] = performance.now();
      if (rows === undefined) return;
      // the real Liste: one table (FeatureList) with the name and four property columns, every row in the DOM
      const columns = ['stage', 'vitalitaet', 'art', 'hoehe_m'].map((key) => ({ key, label: key }));
      const groups = groupRows(rows, () => 'baum', () => 'Baum', () => columns);
      const target = document.getElementById('app');
      if (target === null) throw new Error('no app element');
      const labels = { empty: '-', sortedAscending: 'asc', sortedDescending: 'desc' };
      mount(ListView, { target, props: { heading: 'Liste', groups, labels, sort: [], onfeature: () => undefined } });
      void afterPaint().then((t) => (m['listPainted'] = t));
    });
};

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
(window as unknown as { benchFilter: () => Promise<void> }).benchFilter = async () => {
  const controller = createFilterController();
  const wrapped = filteredSource(sourceOf(mem, config), (f) => mem.feature(f), config, controller);
  let shown = 0;
  wrapped.subscribe(EVERYWHERE, (c) => {
    shown += c.add.length - c.remove.length;
  });
  while (shown === 0) await delay(50); // the first delivery
  await delay(1500);
  const rows = shown;
  m['rows'] = rows;
  m['filterAt'] = performance.now();
  await delay(0); // the trigger is a task of its own, so it starts after `filterAt`
  slowdown();
  controller.setType('baum' as Key, false);
  while (shown !== 0) await delay(0);
  controller.setType('baum' as Key, true);
  while (shown !== rows) await delay(0);
  m['filterDone'] = performance.now();
};

bench.ready = true;
