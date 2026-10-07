<script lang="ts">
  // Header of the form editor (v3 `FormEditorView.svelte:420-436`): the title, the task and the close button that
  // goes back to the task. v3's name input did nothing for a task form, so it is a static title.
  import X from '@lucide/svelte/icons/x';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { Translate } from '../../shell/messages';

  interface Props {
    t: Translate;
    taskName: string;
    onclose: () => void;
  }
  let { t, taskName, onclose }: Props = $props();
</script>

<header class="head">
  <div class="head-text">
    <h2 class="title">{t('tp_edit_fields')}</h2>
    <p class="sub" title={taskName}>{t('form_task', { name: taskName })}</p>
  </div>
  <Button
    variant="ghost"
    size="icon"
    class="close"
    aria-label={t('form_close')}
    title={t('form_close')}
    data-testid="form-close"
    onclick={onclose}
  >
    <X class="h-4 w-4" />
  </Button>
</header>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }
  .head-text {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  .sub {
    margin: 0;
    overflow: hidden;
    font-size: 0.75rem;
    color: var(--muted-foreground);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .head :global(.close) {
    flex-shrink: 0;
  }
  @container (max-width: 499px) {
    /* The sheet's own close button sits in the corner; the editor's close button stays clear of it. */
    .head {
      padding-right: 3.25rem;
    }
  }
</style>
