<script lang="ts">
  // Test harness: the shell with every slot filled, driven by plain props (jsdom specs and the e2e harness).
  import ModuleShell from '../ModuleShell.svelte';

  interface Props {
    open?: boolean;
    expanded?: boolean;
    loading?: boolean;
    error?: string | null;
    empty?: boolean;
    badge?: string | undefined;
    peekVh?: number | undefined;
    expandedVh?: number | undefined;
    onclose?: (() => void) | undefined;
    onnext?: (() => void) | undefined;
    onprevious?: (() => void) | undefined;
    lines?: number;
  }
  let {
    open = true,
    expanded = $bindable(false),
    loading = false,
    error = null,
    empty = false,
    badge,
    peekVh,
    expandedVh,
    onclose,
    onnext,
    onprevious,
    lines = 60,
  }: Props = $props();
</script>

{#snippet actions()}<button type="button" data-testid="header-action">Aktion</button>{/snippet}
{#snippet foot()}<p data-testid="footer">Fuß</p>{/snippet}
{#snippet body()}
  <div data-testid="body">
    {#each Array.from({ length: lines }, (_, i) => i) as i (i)}<p class="p-1">Zeile {i}</p>{/each}
  </div>
{/snippet}

{#if empty}
  <ModuleShell
    {open}
    bind:expanded
    title="Baum"
    {loading}
    {error}
    {onclose}
    toggleLabel="Größe ändern"
    footer={foot}
  />
{:else}
  <ModuleShell
    {open}
    bind:expanded
    title="Baum"
    subtitle="Alte Eiche"
    {badge}
    {loading}
    {error}
    {peekVh}
    {expandedVh}
    {onclose}
    {onnext}
    {onprevious}
    toggleLabel="Größe ändern"
    headerActions={actions}
    footer={foot}
    children={body}
  />
{/if}
