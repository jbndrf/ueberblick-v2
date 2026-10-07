// Scenario form-50-fields: tap "Open form" mounts the real FormRenderer with 50 fields; then keystrokes.
// Measures interaction to next paint for the open and for the slowest keystroke.
import { mount } from 'svelte';
import FormRenderer from '../../../../packages/ui/src/form/FormRenderer.svelte';
import { newSession, prepare } from '../../lib/task-world';
import { inpSince, installProbe, slowdown } from '../../lib/probe';

const world = prepare(50);
const bench = installProbe();
bench.metrics['open'] = Number.NaN;
bench.metrics['keystroke'] = Number.NaN;

document.getElementById('open')?.addEventListener('click', (e) => {
  const session = newSession(world);
  const host = document.getElementById('host');
  if (host === null) throw new Error('no host');
  mount(FormRenderer, { target: host, props: { session, onsubmit: () => undefined } });
  slowdown();
  void inpSince(e).then((ms) => (bench.metrics['open'] = ms));
});

document.addEventListener('input', (e) => {
  void inpSince(e).then((ms) => {
    const prev = bench.metrics['keystroke'] ?? Number.NaN;
    bench.metrics['keystroke'] = Number.isNaN(prev) ? ms : Math.max(prev, ms);
  });
});
bench.ready = true;
