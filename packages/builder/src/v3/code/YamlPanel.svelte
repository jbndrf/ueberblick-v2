<script lang="ts">
  import { copyText } from '../shared/clipboard';
  // v3 `WorkflowCodeView.svelte` and `inspector/EntityYamlView.svelte`, which were the same panel twice:
  // a bar (hint; Kopieren, Neu laden, Übernehmen), the error or "Übernommen" message, then the editor.
  // Here it is one component (R1). Apply turns the text into overlay ops (`check` is the Doc's one
  // YAML-to-ops path) and hands them to the frame; it does not save, as in v3: the toolbar's Speichern does.
  import { untrack } from 'svelte';
  import Check from '@lucide/svelte/icons/check';
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import FileWarning from '@lucide/svelte/icons/file-warning';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { EntityYamlProblem, Op } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import CodeEditor from './CodeEditor.svelte';
  import type { RefSources } from './refs';
  import { refusalText } from '../shell/refusal';

  type Checked =
    | { readonly ok: true; readonly ops: readonly Op[] }
    | { readonly ok: false; readonly problems: readonly EntityYamlProblem[] };

  interface Props {
    ctx: BuilderContext;
    testid: string;
    /** The message that explains this panel (the Objektart's or one element's). */
    hint: string;
    /** The canonical text the document stands for now. */
    source: string;
    /** The Doc's one YAML-to-ops path, for the whole text. */
    check: (text: string) => Checked;
    /** The provenance of each line of `text`. */
    marks: (text: string) => readonly string[];
    sources: RefSources;
  }
  let { ctx, testid, hint, source, check, marks, sources }: Props = $props();

  const t = $derived(ctx.t);
  let text = $state(untrack(() => source));
  let baseline = untrack(() => source);
  let reseed = false;
  /** The text the checks last ran on: typing is debounced so a large project stays smooth (R14). */
  let checked = $state(untrack(() => source));
  let message: 'applied' | 'unchanged' | undefined = $state();
  let refusal = $state('');
  let copied = $state(false);

  // The document changed: after our own apply or with an untouched editor the canonical text comes back in.
  $effect(() => {
    const next = source;
    untrack(() => {
      if (next === baseline) return;
      const untouched = text === baseline;
      baseline = next;
      if (untouched || reseed) {
        reseed = false;
        text = next;
        checked = next;
      }
    });
  });
  $effect(() => {
    const now = text;
    const h = setTimeout(() => (checked = now), 150);
    return () => clearTimeout(h);
  });

  const result = $derived(check(checked));
  const problems = $derived(
    result.ok
      ? []
      : result.problems.map((p) => ({
          line: p.line ?? 1,
          message: labelOf(p.message as never, ctx.locale, p.code),
        })),
  );
  const lineMarks = $derived(marks(checked));
  const labels = $derived<Record<string, string>>({
    template: t('code_prov_template'),
    changed: t('code_prov_changed'),
    added: t('code_prov_added'),
  });
  const dirty = $derived(text !== source);

  function edit(next: string): void {
    // The editor echoes a text we pushed in ourselves (reload, canonical text after apply): not an edit.
    if (next === text) return;
    text = next;
    message = undefined;
    refusal = '';
  }

  function apply(): void {
    checked = text;
    const r = check(text);
    message = undefined;
    refusal = '';
    if (!r.ok) return;
    if (r.ops.length === 0) {
      message = 'unchanged';
      return;
    }
    reseed = true;
    for (const op of r.ops) {
      const done = ctx.apply(op);
      if (done.refused !== undefined) {
        refusal = refusalText(ctx.t, ctx.doc(), [op], done.refused, ctx.locale);
        reseed = false;
        return;
      }
    }
    message = 'applied';
  }

  function reload(): void {
    text = source;
    checked = source;
    message = undefined;
    refusal = '';
  }

  async function copy(): Promise<void> {
    if (await copyText(text)) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    }
  }
</script>

<div class="panel" data-testid={testid}>
  <div class="bar">
    <p class="hint">{hint}</p>
    <div class="actions">
      <Button variant="ghost" size="sm" onclick={copy} data-testid="code-copy">
        {#if copied}<Check />{:else}<ClipboardCopy />{/if}
        {copied ? t('code_copied') : t('code_copy')}
      </Button>
      <Button variant="ghost" size="sm" onclick={reload} data-testid="code-reload">
        <RefreshCw />
        {t('code_reload')}
      </Button>
      <Button size="sm" onclick={apply} disabled={!dirty} data-testid="code-apply">{t('code_apply')}</Button>
    </div>
  </div>

  {#if problems.length > 0}
    <div class="messages error" role="alert" data-testid="code-problems">
      <FileWarning />
      <ul>
        {#each problems as p, i (i)}
          <li>{t('code_problem_line', { n: p.line })}: {p.message}</li>
        {/each}
      </ul>
    </div>
  {:else if refusal !== ''}
    <p class="messages error" role="alert"><FileWarning /> {refusal}</p>
  {:else if message !== undefined}
    <p class="messages ok" role="status" data-testid="code-message">
      <Check />
      {message === 'applied' ? t('code_applied') : t('code_unchanged')}
    </p>
  {/if}

  <CodeEditor
    value={text}
    label={t('code_editor')}
    marks={lineMarks}
    provenanceLabels={labels}
    {problems}
    {sources}
    loading={t('code_loading')}
    loadFailed={t('code_load_failed')}
    onchange={edit}
  />

  <ul class="legend" aria-label={t('code_provenance')}>
    <li><span class="swatch template"></span>{t('code_prov_template')}</li>
    <li><span class="swatch changed"></span>{t('code_prov_changed')}</li>
    <li><span class="swatch added"></span>{t('code_prov_added')}</li>
  </ul>
</div>

<style>
  .panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    min-width: 0;
    min-height: 0;
    padding: 0.75rem 1rem;
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .hint {
    margin: 0;
    max-width: 60ch;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .messages {
    display: flex;
    align-items: flex-start;
    gap: 0.375rem;
    margin: 0;
    font-size: 0.8125rem;
  }
  .messages :global(svg) {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
  }
  .messages ul {
    margin: 0;
    padding-left: 1rem;
  }
  .error {
    color: var(--destructive);
  }
  .ok {
    color: var(--muted-foreground);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .swatch {
    width: 0.25rem;
    height: 0.875rem;
    border: 1px solid var(--border);
  }
  .swatch.changed {
    border-color: var(--chart-4, #d97706);
    background: var(--chart-4, #d97706);
  }
  .swatch.added {
    border-color: var(--chart-2, #16a34a);
    background: var(--chart-2, #16a34a);
  }
  @media (max-width: 767px) {
    .panel {
      padding: 0.5rem;
    }
  }
</style>
