<script lang="ts">
  // v3 `components/InlineEdit.svelte`: the one "rename in place" control of the builder. The text
  // is a button; the chosen gesture turns it into an input, Enter or blur commits, Escape cancels,
  // empty reverts. v3 started on a click (stage titles); `trigger="dblclick"` is for labels that a
  // click selects (task buttons). `editing` can be set from outside, so a key can start it (F2).
  interface Props {
    value: string;
    oncommit: (value: string) => void;
    class?: string;
    ariaLabel?: string;
    /** The tooltip of the display button (v3 `editTitle`, "Click to rename"). */
    editTitle?: string;
    trigger?: 'click' | 'dblclick';
    editing?: boolean;
    disabled?: boolean;
  }
  let {
    value,
    oncommit,
    class: className = '',
    ariaLabel,
    editTitle,
    trigger = 'click',
    editing = $bindable(false),
    disabled = false,
  }: Props = $props();

  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!editing) draft = value;
  });
  $effect(() => {
    if (editing && inputEl) {
      inputEl.focus();
      inputEl.select();
    }
  });

  function start(): void {
    draft = value;
    editing = true;
  }
  function commit(): void {
    if (!editing) return;
    editing = false;
    const text = draft.trim();
    if (text !== '' && text !== value) oncommit(text);
    else draft = value;
  }
  /**
   * A native listener, not Svelte's delegated `ondblclick`: the flow's pan/zoom layer sits between
   * the node and the document and can swallow a delegated double-click before it arrives.
   */
  function onDouble(node: HTMLElement): () => void {
    const handler = (e: Event): void => {
      if (trigger !== 'dblclick') return;
      e.stopPropagation();
      start();
    };
    node.addEventListener('dblclick', handler);
    return () => node.removeEventListener('dblclick', handler);
  }
  function cancel(): void {
    draft = value;
    editing = false;
  }
  function onkeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
</script>

{#if disabled}
  <span class={className} aria-label={ariaLabel}>{value}</span>
{:else if editing}
  <input
    bind:this={inputEl}
    class="inline-edit nodrag nopan {className}"
    bind:value={draft}
    onblur={commit}
    {onkeydown}
    onclick={(e) => e.stopPropagation()}
    ondblclick={(e) => e.stopPropagation()}
    aria-label={ariaLabel}
  />
{:else}
  <button
    type="button"
    class="inline-edit-text nodrag {className}"
    title={editTitle}
    aria-label={ariaLabel}
    tabindex={trigger === 'click' ? 0 : -1}
    onclick={() => {
      if (trigger === 'click') start();
    }}
    {@attach onDouble}
  >
    {value}
  </button>
{/if}
