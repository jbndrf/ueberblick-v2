<script lang="ts">
  // Sign-in: `/login`, or `/login?token=…` (the printed link: signs in without a tap and lands on the map).
  import { goto } from '$app/navigation';
  import LoginPage from '$lib/participant/login/LoginPage.svelte';
  import { loadScanner } from '$lib/participant/login/scanner';
</script>

<LoginPage
  fetch={(input, init) => fetch(input, init)}
  load={loadScanner}
  go={(path) => goto(path, { replaceState: true })}
  leave={(path) => location.replace(path)}
/>
