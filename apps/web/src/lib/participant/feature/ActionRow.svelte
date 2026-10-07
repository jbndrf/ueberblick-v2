<script lang="ts">
  // v3's action row (v3 detail module, lines 1260-1290): one button per available task, side by side in
  // a scrolling row with a fade at the edges that have more. The admin's colour paints the button; no colour, the
  // secondary button.
  import type { Key } from '@ueberblick/core/model';
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { message, type Locale } from '../messages';
  import { taskIcon } from './task-icons';
  import type { EditActions, PresentedTask } from './task-presentation';

  interface Props {
    tasks: readonly PresentedTask[];
    label: string;
    locale: Locale;
    onstart: (task: Key) => void;
    edit?: EditActions | undefined;
  }
  let { tasks, label, locale, onstart, edit }: Props = $props();

  // A task with a confirmation and without several steps asks on the tap; the tap that confirms is the start. A task with
  // several steps asks at Absenden, in the steps host (`confirmTiming`, WP-730), so `confirm` is absent here.
  let asking: PresentedTask | undefined = $state();
  function tap(task: PresentedTask): void {
    if (task.confirm === undefined) onstart(task.key);
    else asking = task;
  }

  let row: HTMLElement | undefined = $state();
  let scrolled = $state(false);
  let atEnd = $state(true);
  const EDGE_PX = 4;

  function measure(): void {
    if (!row) return;
    scrolled = row.scrollLeft > EDGE_PX;
    atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - EDGE_PX;
  }
  $effect(() => {
    void tasks;
    measure();
  });
</script>

{#if edit}
  <div class="mb-4" role="group" aria-label={label}>
    <div class="flex gap-2.5 pb-2">
      <button type="button" class="action-btn rowbtn" disabled={edit.saving} onclick={edit.oncancel}>
        <span class="text-xs font-semibold">{message(locale, 'feature_edit_cancel')}</span>
      </button>
      <button
        type="button"
        class="action-btn colored rowbtn"
        style="--btn-color: #16a34a"
        disabled={edit.saving}
        onclick={edit.onsave}
      >
        <span class="text-xs font-semibold">{message(locale, 'feature_edit_save')}</span>
      </button>
    </div>
  </div>
{:else if tasks.length > 0}
  <div class="mb-4" role="group" aria-label={label}>
    <div class="fade" class:scrolled class:at-end={atEnd}>
      <div
        class="flex gap-2.5 overflow-x-auto pr-6 pb-2"
        bind:this={row}
        onscroll={measure}
        role="presentation"
      >
        {#each tasks as task (task.key)}
          <button
            type="button"
            class="action-btn relative flex min-h-[56px] max-w-[104px] min-w-[72px] flex-shrink-0 flex-col items-center justify-center rounded-xl px-3 py-2.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
            class:colored={task.color !== undefined}
            style={task.color === undefined ? undefined : `--btn-color: ${task.color}`}
            onclick={() => tap(task)}
          >
            {#if task.icon !== undefined}
              {@const Icon = taskIcon(task.icon)}
              {#if Icon}<Icon class="mb-1 h-4 w-4" aria-hidden="true" />{/if}
            {/if}
            <span class="line-clamp-2 text-center text-xs leading-snug font-semibold">{task.label}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
{/if}

{#if asking}
  <AlertDialog.Root open={true} onOpenChange={(open) => !open && (asking = undefined)}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>{asking.label}</AlertDialog.Title>
        <AlertDialog.Description>{asking.confirm}</AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>{message(locale, 'feature_confirm_cancel')}</AlertDialog.Cancel>
        <AlertDialog.Action
          onclick={() => {
            const task = asking;
            asking = undefined;
            if (task) onstart(task.key);
          }}
        >
          {message(locale, 'feature_confirm_go')}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
{/if}

<style>
  .rowbtn {
    display: flex;
    min-height: 56px;
    min-width: 72px;
    max-width: 104px;
    align-items: center;
    justify-content: center;
    border-radius: 0.75rem;
    padding: 0.625rem 0.75rem;
  }
  .rowbtn:disabled {
    pointer-events: none;
    opacity: 0.5;
  }
  .action-btn {
    background-color: var(--secondary);
    color: var(--secondary-foreground);
    border: 1px solid var(--border);
    box-shadow:
      0 1px 3px 0 rgb(0 0 0 / 0.05),
      0 1px 2px -1px rgb(0 0 0 / 0.05);
  }
  .action-btn:hover {
    background-color: var(--accent);
    border-color: var(--accent);
  }
  :global(.dark) .action-btn {
    background-color: color-mix(in srgb, var(--secondary) 80%, transparent);
    border-color: color-mix(in srgb, var(--border) 50%, transparent);
  }
  :global(.dark) .action-btn:hover {
    background-color: var(--accent);
    border-color: var(--accent);
  }
  .action-btn.colored {
    background-color: var(--btn-color);
    color: white;
    border-color: transparent;
    text-shadow: 0 1px 1px rgb(0 0 0 / 0.15);
    box-shadow:
      0 2px 4px -1px color-mix(in srgb, var(--btn-color) 40%, transparent),
      0 1px 2px -1px color-mix(in srgb, var(--btn-color) 30%, transparent);
  }
  .action-btn.colored:hover {
    filter: brightness(1.08);
    box-shadow:
      0 4px 8px -2px color-mix(in srgb, var(--btn-color) 45%, transparent),
      0 2px 4px -2px color-mix(in srgb, var(--btn-color) 35%, transparent);
  }
  :global(.dark) .action-btn.colored {
    background-color: color-mix(in srgb, var(--btn-color) 85%, black);
    box-shadow:
      0 2px 6px -1px color-mix(in srgb, var(--btn-color) 35%, transparent),
      0 0 0 1px color-mix(in srgb, var(--btn-color) 50%, transparent);
  }
  :global(.dark) .action-btn.colored:hover {
    background-color: color-mix(in srgb, var(--btn-color) 95%, black);
    filter: brightness(1.1);
  }
  /* The row fades where there is more to scroll to. */
  .fade {
    mask-image: linear-gradient(to right, #000 0, #000 calc(100% - 32px), transparent 100%);
  }
  .fade.scrolled:not(.at-end) {
    mask-image: linear-gradient(to right, transparent 0, #000 32px, #000 calc(100% - 32px), transparent 100%);
  }
  .fade.scrolled.at-end {
    mask-image: linear-gradient(to right, transparent 0, #000 32px, #000 100%);
  }
  .fade.at-end:not(.scrolled) {
    mask-image: none;
  }
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
