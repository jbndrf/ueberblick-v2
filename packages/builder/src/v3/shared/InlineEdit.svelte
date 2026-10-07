<script lang="ts">
  // v3 `components/InlineEdit.svelte`: the one "rename in place" control of the builder. The value is
  // clickable text; a click turns it into an input. Enter or blur commits, Escape cancels, empty reverts.
  interface Props {
    value: string;
    oncommit: (value: string) => void;
    placeholder?: string;
    class?: string;
    ariaLabel?: string;
    /** Tooltip of the display button (v3: "Zum Umbenennen klicken"). */
    editTitle?: string;
    /** Commit an empty text too (default: empty reverts). */
    allowEmpty?: boolean;
    /** Plain text, no click-to-edit (a locked name). */
    disabled?: boolean;
  }
  let {
    value,
    oncommit,
    placeholder = '',
    class: className = '',
    ariaLabel,
    editTitle,
    allowEmpty = false,
    disabled = false,
  }: Props = $props();

  let editing = $state(false);
  let draft = $state('');
  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (editing && inputEl !== undefined) {
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
    if ((text !== '' || allowEmpty) && text !== value) oncommit(text);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editing = false;
    }
  }
</script>

{#if disabled}
  <span class={className} aria-label={ariaLabel}>{value || placeholder}</span>
{:else if editing}
  <input
    bind:this={inputEl}
    class={className}
    bind:value={draft}
    onblur={commit}
    {onkeydown}
    {placeholder}
    aria-label={ariaLabel}
  />
{:else}
  <button type="button" class={className} onclick={start} title={editTitle} aria-label={ariaLabel}
    >{value || placeholder}</button
  >
{/if}
