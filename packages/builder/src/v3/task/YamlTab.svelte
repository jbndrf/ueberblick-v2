<script lang="ts">
  // v3 `TaskConfigSidebar.svelte:446-460`, the YAML tab: the whole task as text, "YAML anwenden". v3
  // decomposed the text into its task store; here `Doc.applyEntityYaml` turns the edited text into the
  // minimal overlay ops (all or none) and the frame applies them.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { applyOps } from '../../doc';
  import { labelOf } from '../../shell/location';
  import type { BuilderContext } from '../shell/context';
  import { refusalText } from '../shell/refusal';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const doc = $derived(ctx.doc());
  const path = $derived(`tasks.${task}`);
  const source = $derived(doc.entityYaml(path).text);

  let text = $state('');
  let dirty = $state(false);
  let error: string | undefined = $state();
  let seen = '';

  // Reseed when the file's text of this task changes and the editor is untouched (v3: when the task changes).
  $effect(() => {
    if (!dirty && seen !== source) {
      seen = source;
      text = source;
    }
  });
  $effect(() => {
    void task;
    dirty = false;
    seen = '';
  });

  function apply(): void {
    const r = doc.applyEntityYaml(path, text);
    if (!r.ok) {
      const p = r.problems[0];
      error =
        p === undefined
          ? t('tp_yaml_invalid')
          : `${t('tp_yaml_invalid')}: ${labelOf(p.message, ctx.locale, p.code)}${p.line === undefined ? '' : ` (${p.line})`}`;
      return;
    }
    const batch = applyOps(doc, r.ops);
    if ('refused' in batch) {
      error = `${t('tp_yaml_invalid')}: ${refusalText(ctx.t, doc, r.ops, batch.refused, ctx.locale)}`;
      return;
    }
    for (const op of r.ops) ctx.apply(op);
    error = undefined;
    dirty = false;
  }
</script>

<div class="tab" data-testid="task-tab-yaml">
  <p class="hint">{t('tp_yaml_hint')}</p>
  <textarea
    class="code"
    rows="14"
    spellcheck="false"
    aria-label={t('tp_tab_yaml')}
    data-testid="task-yaml"
    bind:value={text}
    oninput={() => (dirty = true)}
  ></textarea>
  {#if error !== undefined}<p class="error" role="alert">{error}</p>{/if}
  <Button size="sm" onclick={apply} disabled={!dirty}>{t('tp_yaml_apply')}</Button>
</div>

<style>
  .tab {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .hint {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted-foreground);
  }
  .code {
    width: 100%;
    min-height: 16rem;
    padding: 0.5rem;
    font:
      0.75rem/1.5 ui-monospace,
      monospace;
    color: var(--foreground);
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    resize: vertical;
  }
  .error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--destructive);
  }
</style>
