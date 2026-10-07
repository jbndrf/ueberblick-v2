// Scenario task-sheet: tap "New task" opens the real Sheet with a 12-field task form.
import { mount } from 'svelte';
import { installProbe } from '../../lib/probe';
import Page from './Page.svelte';

const bench = installProbe();
bench.metrics['open'] = Number.NaN;
const target = document.getElementById('app');
if (target === null) throw new Error('no app element');
mount(Page, { target, props: { record: (ms: number) => (bench.metrics['open'] = ms) } });
bench.ready = true;
