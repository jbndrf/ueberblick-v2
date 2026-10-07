import { mount } from 'svelte';
import '../../../app.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import Harness from './testing/Harness.svelte';

mount(Harness, { target: document.getElementById('app') as HTMLElement });
