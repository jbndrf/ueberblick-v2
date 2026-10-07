<script lang="ts">
  // v3 `code-view/CodeView.svelte`: the one YAML editor of the builder (the Code view and the inspector's
  // YAML toggle both use it, R1). CodeMirror is a separate chunk, loaded when the first editor mounts.
  import { onMount } from 'svelte';
  import type { EditorHandle, EditorProblem } from './editor';
  import { completeRefs, type RefSources } from './refs';

  interface Props {
    value: string;
    /** Accessible name of the editing area. */
    label: string;
    /** The provenance of each line of `value` (index 0 is line 1). */
    marks: readonly string[];
    provenanceLabels: Readonly<Record<string, string>>;
    problems: readonly EditorProblem[];
    sources: RefSources;
    loading: string;
    loadFailed: string;
    onchange: (text: string) => void;
  }
  let { value, label, marks, provenanceLabels, problems, sources, loading, loadFailed, onchange }: Props =
    $props();

  let host: HTMLDivElement | undefined = $state();
  let handle: EditorHandle | undefined = $state.raw();
  let failed = $state(false);
  // The completion source is built once at mount; it reads the latest project keys through this holder.
  const holder: { sources: RefSources } = { sources: {} };
  $effect(() => {
    holder.sources = sources;
  });

  onMount(() => {
    let gone = false;
    import('./editor').then(
      (mod) => {
        if (gone || host === undefined) return;
        handle = mod.mountEditor({
          parent: host,
          text: value,
          label,
          provenanceLabels,
          fold: true,
          indentWithTab: true,
          complete: (text, pos) => {
            const r = completeRefs(text, pos, holder.sources);
            return r && { from: r.from, options: r.options.map((o) => ({ ...o, type: o.kind })) };
          },
          onchange: (text) => onchange(text),
        });
      },
      () => (failed = true),
    );
    return () => {
      gone = true;
      handle?.destroy();
    };
  });

  // The order matters: new text first, then the marks and problems that refer to its lines.
  $effect(() => handle?.setText(value));
  $effect(() => handle?.setMarks(marks));
  $effect(() => handle?.setProblems(problems));
</script>

<div class="editor" bind:this={host} data-testid="code-editor">
  {#if handle === undefined}
    <p class="status" role="status">{failed ? loadFailed : loading}</p>
  {/if}
</div>

<style>
  .editor {
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--background);
  }
  .editor :global(.cm-editor) {
    height: 100%;
  }
  .status {
    margin: 0.75rem;
    font-size: 0.8125rem;
    color: var(--muted-foreground);
  }
</style>
