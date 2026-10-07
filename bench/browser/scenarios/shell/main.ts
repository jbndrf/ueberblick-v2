// Scenario shell: first render of the participant app shell (real AppShell, model from a small project file).
import { mount } from 'svelte';
import { afterPaint, installProbe, slowdown } from '../../lib/probe';
import Page from './Page.svelte';

const bench = installProbe();
bench.metrics['firstRender'] = Number.NaN;
const target = document.getElementById('app');
if (target === null) throw new Error('no app element');
mount(Page, { target });
slowdown();
// performance.now() counts from navigation start, so this is "navigation to painted shell".
void afterPaint().then((t) => {
  bench.metrics['firstRender'] = t;
  bench.ready = true;
});
