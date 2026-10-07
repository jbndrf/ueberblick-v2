<script lang="ts">
  // The small mark of where an element comes from (the template, changed against it, added by the project), shown
  // where the admin edits the element: a form field card, the task pane. New in v4 (v3 had no templates): the engine
  // needs the admin to see what a deploy of a newer template would touch (register a3 row 102). One component for
  // every place (R1); a locked element shows the lock beside the mark, with the reason as its title.
  import Lock from '@lucide/svelte/icons/lock';
  import type { Translate } from '../../shell/messages';
  import { provenanceLabel, type ProvenanceInfo } from './provenance';

  interface Props {
    t: Translate;
    info: ProvenanceInfo;
    /** Only the dot, the name as its title: on a canvas node, where a word would crowd the label. */
    compact?: boolean;
  }
  let { t, info, compact = false }: Props = $props();
  const label = $derived(t(provenanceLabel(info.kind)));
</script>

<span
  class="mark"
  class:compact
  data-testid="provenance-mark"
  data-provenance={info.kind}
  title={compact ? label : undefined}
>
  <span class="dot"></span>{#if compact}<span class="sr-only">{label}</span>{:else}{label}{/if}
</span>
{#if info.lock !== undefined}
  <span
    class="lock"
    data-testid="provenance-lock"
    role="img"
    title={t('prov_locked', { lock: info.lock })}
    aria-label={t('prov_locked', { lock: info.lock })}><Lock size={12} /></span
  >
{/if}

<style>
  .mark {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0 0.375rem;
    font-size: 0.6875rem;
    line-height: 1.125rem;
    color: var(--muted-foreground);
    background: var(--muted);
    border-radius: 0.25rem;
    white-space: nowrap;
  }
  .dot {
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--muted-foreground);
  }
  .mark.compact {
    padding: 0;
    background: none;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .mark[data-provenance='changed'] .dot {
    background: hsl(38 92% 50%);
  }
  .mark[data-provenance='added'] .dot {
    background: hsl(142 71% 40%);
  }
  .lock {
    display: inline-flex;
    color: var(--muted-foreground);
  }
</style>
