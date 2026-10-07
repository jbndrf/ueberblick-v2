import { mount } from 'svelte';
import '../../app.css';
import { setLocale } from '../../paraglide/runtime.js';
import Harness from './Harness.svelte';

setLocale('de', { reload: false });
mount(Harness, { target: document.getElementById('app') as HTMLElement });
