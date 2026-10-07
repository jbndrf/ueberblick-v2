<script lang="ts">
  // A stand-in map (a button that must stay usable under the non-modal shell) and the real shell. Test fixture only.
  // `?state=loading|error|empty` picks a state; `?cluster=1` uses the cluster detail's 35/75 vh.
  import ModuleShell from '../../testing/ModuleShell.testing.svelte';

  const params = new URLSearchParams(location.search);
  let open = $state(true);
  let closes = $state(0);
  let mapTaps = $state(0);
</script>

<button
  type="button"
  class="fixed top-20 left-4 z-10 rounded border p-2"
  data-testid="map"
  onclick={() => mapTaps++}>Karte</button
>
<button type="button" class="fixed top-32 left-4 z-10 rounded border p-2" onclick={() => (open = true)}
  >Öffnen</button
>
<p class="fixed bottom-2 left-2 z-10 text-xs" data-testid="result">
  closes={closes} map={mapTaps} open={open}
</p>
<ModuleShell
  {open}
  loading={params.get('state') === 'loading'}
  error={params.get('state') === 'error' ? 'Nicht gefunden' : null}
  empty={params.get('state') === 'empty'}
  badge={params.get('badge') ?? undefined}
  expandedVh={params.get('cluster') === '1' ? 75 : undefined}
  onclose={() => {
    closes++;
    open = false;
  }}
/>
