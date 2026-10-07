<script lang="ts">
  // The + picker (v3 WorkflowSelector, popover menu): one pill per Objektart the role may create. Mobile: above the
  // bottom bar; desktop: below the header. The backdrop closes it. Beside Zuletzt it sits in the left half
  // (`position='left'`); at the role's quota the pills are disabled and a hint says why (WorkflowSelector.svelte:340-395).
  import { LAYER } from '../../layers';
  import { message, type Locale } from '../../messages';
  import type { Pill } from './creatable';

  interface Props {
    pills: readonly Pill[];
    locale: Locale;
    position?: 'center' | 'left';
    quotaReached?: boolean;
    onselect: (pill: Pill) => void;
    onclose: () => void;
  }
  let { pills, locale, position = 'center', quotaReached = false, onselect, onclose }: Props = $props();

  // Escape closes the picker, the topmost layer here, and nothing under it: the capture listener runs before the
  // detail's own (`ModuleShell`) and stops the event (v3 had no Escape for the picker, so it closed the detail).
  $effect(() => {
    if (pills.length === 0) return;
    const escape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      onclose();
    };
    window.addEventListener('keydown', escape, { capture: true });
    return () => window.removeEventListener('keydown', escape, { capture: true });
  });
</script>

{#if pills.length > 0}
  <button
    type="button"
    class={['fixed inset-0 bg-transparent md:top-[var(--ub-header-h)]', LAYER.pickerBackdrop]}
    aria-label={message(locale, 'create_close')}
    onclick={onclose}
  ></button>
  <div
    role="group"
    aria-label={message(locale, 'create_title')}
    data-testid="create-picker"
    class={[
      'fixed bottom-20 flex flex-col items-center gap-2.5 md:top-[calc(var(--ub-header-h)+0.5rem)] md:bottom-auto',
      LAYER.pill,
      position === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-4 md:left-16',
    ]}
  >
    {#if quotaReached}
      <div
        role="status"
        class="workflow-item max-w-[260px] rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-xs font-medium text-destructive shadow-lg shadow-black/5 backdrop-blur-md dark:bg-destructive/20 dark:shadow-black/20"
      >
        {message(locale, 'create_quota')}
      </div>
    {/if}
    {#each pills as pill, i (pill.taskKey)}
      <button
        type="button"
        data-testid="create-pill"
        data-task={pill.taskKey}
        disabled={quotaReached}
        aria-disabled={quotaReached}
        onclick={() => onselect(pill)}
        style="animation-delay: {i * 0.03}s"
        class="workflow-item max-w-[200px] min-w-[100px] rounded-xl border border-border/50 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg shadow-black/5 backdrop-blur-md transition-all duration-200 ease-out hover:scale-[1.02] hover:border-accent-foreground/20 hover:bg-accent active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:border-border/50 disabled:hover:bg-background/95 dark:border-border/30 dark:bg-muted/90 dark:shadow-black/20"
      >
        <span class="line-clamp-2 text-center leading-snug">{pill.label}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  /* v3 `slideIn`: each pill rises 10 px and fades in, 0.2 s, 0.03 s after the one before */
  .workflow-item {
    animation: slideIn 0.2s ease-out backwards;
  }
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .workflow-item {
      animation: none;
    }
  }
</style>
