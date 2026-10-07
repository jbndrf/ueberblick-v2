<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { ModeWatcher } from 'mode-watcher';

  let { children }: { children: Snippet } = $props();
</script>

<!-- app.html sets the `dark` class before first paint (nonce CSP allows only its own script); ModeWatcher keeps it in sync after. -->
<ModeWatcher disableHeadScriptInjection />
{@render children()}
