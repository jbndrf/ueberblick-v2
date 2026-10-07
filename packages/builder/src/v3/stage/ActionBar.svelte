<script lang="ts">
  // v3 `ParticipantPreview.svelte:166-228`: the action roll bar. A dashed "+" adds a button to this
  // stage, then one coloured button per task (a stage's own, then the global ones). A button the
  // chosen role is not offered is dimmed and says why; a click opens its task. The wheel scrolls sideways.
  import Globe from '@lucide/svelte/icons/globe';
  import Cog from '@lucide/svelte/icons/cog';
  import Plus from '@lucide/svelte/icons/plus';
  import Square from '@lucide/svelte/icons/square';
  import type { Translate } from '../../shell/messages';
  import type { PreviewButton } from './preview';

  interface Props {
    buttons: readonly PreviewButton[];
    t: Translate;
    selected: string | null;
    onselect: (key: string) => void;
    onadd: () => void;
  }
  let { buttons, t, selected, onselect, onadd }: Props = $props();

  /** v3 `DEFAULT_BUTTON_COLOR` (cool slate): a task without `button.color`. */
  const DEFAULT_BUTTON_COLOR = '#64748b';

  function wheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).scrollLeft += event.deltaY;
  }
</script>

<div class="bar" role="group" aria-label={t('stage_buttons')} data-testid="stage-buttons">
  <button
    type="button"
    class="add"
    onclick={onadd}
    title={t('stage_add_button')}
    aria-label={t('stage_add_button')}
  >
    <Plus />
  </button>
  <div class="roll" onwheel={wheel} role="presentation">
    {#each buttons as b (b.key)}
      <button
        type="button"
        class="action"
        class:selected={selected === b.key}
        class:dimmed={b.dimmed}
        class:automatic={b.automatic}
        disabled={b.automatic}
        data-automatic={b.automatic}
        data-testid="stage-button"
        data-task={b.key}
        data-dimmed={b.dimmed}
        style="--btn-color: {b.color ?? DEFAULT_BUTTON_COLOR}"
        title={b.automatic
          ? t('canvas_auto_only')
          : b.dimmed && b.why !== undefined
            ? t('stage_not_offered', { why: b.why })
            : b.global
              ? t('stage_global')
              : ''}
        onclick={() => onselect(b.key)}
      >
        <span class="corner">
          {#if b.automatic}<Cog class="mark" />{:else if b.global}<Globe class="mark" />{:else}<Square
              class="mark"
            />{/if}
        </span>
        <span class="label">{b.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .bar {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .add {
    flex-shrink: 0;
    min-width: 56px;
    min-height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.625rem 0.75rem;
    border-radius: 0.75rem;
    border: 2px dashed color-mix(in srgb, var(--muted-foreground) 30%, transparent);
    background: transparent;
    color: color-mix(in srgb, var(--muted-foreground) 50%, transparent);
    cursor: pointer;
    transition: all 0.2s ease-out;
  }
  .add:hover {
    transform: scale(1.02);
    border-color: color-mix(in srgb, var(--muted-foreground) 50%, transparent);
    color: color-mix(in srgb, var(--muted-foreground) 80%, transparent);
  }
  .add:active {
    transform: scale(0.98);
  }
  .add :global(svg) {
    width: 1.25rem;
    height: 1.25rem;
  }
  .roll {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 0.625rem;
    overflow-x: auto;
    padding-bottom: 0.5rem;
    scrollbar-width: thin;
  }
  .action {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 72px;
    max-width: 120px;
    min-height: 56px;
    padding: 0.625rem 0.75rem;
    border-radius: 0.75rem;
    border: 1px solid transparent;
    background-color: var(--btn-color);
    color: white;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.15);
    box-shadow:
      0 2px 4px -1px color-mix(in srgb, var(--btn-color) 40%, transparent),
      0 1px 2px -1px color-mix(in srgb, var(--btn-color) 30%, transparent);
    cursor: pointer;
    transition: all 0.2s ease-out;
  }
  .action:hover {
    transform: translateY(-2px) scale(1.02);
    filter: brightness(1.08);
  }
  .action:active {
    transform: scale(0.98);
  }
  .action.dimmed {
    opacity: 0.4;
  }
  .action.automatic {
    opacity: 0.7;
    cursor: default;
    background-image: repeating-linear-gradient(135deg, transparent 0 6px, rgb(255 255 255 / 0.12) 6px 12px);
  }
  .action.automatic:hover {
    transform: none;
    filter: none;
  }
  .action.selected {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  .corner {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    opacity: 0.6;
  }
  .corner :global(.mark) {
    width: 0.625rem;
    height: 0.625rem;
  }
  .label {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-align: center;
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.35;
  }
  @media (prefers-reduced-motion: reduce) {
    .add,
    .action {
      transition: none;
    }
  }
</style>
