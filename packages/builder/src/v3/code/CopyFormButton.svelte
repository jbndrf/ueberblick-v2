<script lang="ts">
  // v3 "Formular kopieren" (`inspector/EntityYamlView.svelte:86`, `WORKFLOW-YAML-SPEC.md:124-132`): copies the
  // form part of the task (its `form`, and its `steps` when it has them) as YAML, shown in the task pane's
  // YAML tab. The Code view's own copy button is "Kopieren": it copies the whole Objektart (v3 bug 14).
  import ClipboardCopy from '@lucide/svelte/icons/clipboard-copy';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import type { BuilderContext } from '../shell/context';
  import { copyText } from '../shared/clipboard';
  import { formYaml } from './form-yaml';

  interface Props {
    ctx: BuilderContext;
    task: string;
  }
  let { ctx, task }: Props = $props();

  const t = $derived(ctx.t);
  const text = $derived(formYaml(ctx.doc(), task));

  async function copy(): Promise<void> {
    if (await copyText(text)) toast.success(t('tp_form_copied'));
    else toast.error(t('tp_form_copy_failed'));
  }
</script>

<div class="bar">
  <Button
    variant="ghost"
    size="sm"
    onclick={copy}
    disabled={text === ''}
    title={text === '' ? t('tp_form_copy_none') : undefined}
    data-testid="form-copy"
  >
    <ClipboardCopy />
    {t('tp_form_copy')}
  </Button>
</div>

<style>
  .bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.5rem;
  }
</style>
