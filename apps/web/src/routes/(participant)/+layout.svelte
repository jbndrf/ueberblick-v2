<script lang="ts">
  // The design tokens of the normal theme for every participant page (sign-in, consent); the map replaces them with
  // the role's theme (WP-714). One setter: `applyThemeTokens`.
  import type { Snippet } from 'svelte';
  import { applyThemeTokens } from '$lib/participant/shell/theme-style';

  let { children }: { children: Snippet } = $props();
  applyThemeTokens(document.documentElement, 'normal');
</script>

{@render children()}
