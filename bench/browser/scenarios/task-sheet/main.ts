// Scenario task-sheet-50: tap "New task" opens the real Sheet holding the real TaskSheet with 50 fields.
// Measures interaction to next paint of the open (WP-549).
import { mount } from 'svelte';
import { installProbe } from '../../lib/probe';
import Page from './Page.svelte';

const bench = installProbe();
bench.metrics['open'] = Number.NaN;
const target = document.getElementById('app');
if (target === null) throw new Error('no app element');
mount(Page, { target, props: { record: (ms: number) => (bench.metrics['open'] = ms) } });
bench.ready = true;
