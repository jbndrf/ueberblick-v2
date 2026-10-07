import { mount } from 'svelte';
import '../../../../../app.css';
import BuilderHarness from './BuilderHarness.svelte';

mount(BuilderHarness, { target: document.getElementById('app') as HTMLElement });
