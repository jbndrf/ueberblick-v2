import { mount } from 'svelte';
import './harness.css';
import Harness from './Harness.svelte';

mount(Harness, { target: document.getElementById('app') as HTMLElement });
