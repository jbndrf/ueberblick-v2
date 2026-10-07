import { mount } from 'svelte';
import '../../../../app.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import FamilyHarness from './testing/FamilyHarness.svelte';
import Harness from './testing/Harness.svelte';

// `?scene=family`: the family fan (WP-677); otherwise the + flow (WP-652).
const scene = new URLSearchParams(location.search).get('scene');
mount(scene === 'family' ? FamilyHarness : Harness, {
  target: document.getElementById('app') as HTMLElement,
});
