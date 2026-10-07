<script lang="ts">
  // "Formular löschen" (v3 `FormEditorView.svelte:539-546`): takes the form step out of the task.
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import type { Translate } from '../../shell/messages';

  interface Props {
    t: Translate;
    ondelete: () => void;
  }
  let { t, ondelete }: Props = $props();
</script>

<footer class="foot">
  <Button variant="destructive" size="sm" class="w-full" data-testid="form-delete" onclick={ondelete}>
    <Trash2 class="mr-2 h-4 w-4" />
    {t('form_delete')}
  </Button>
</footer>

<style>
  .foot {
    flex-shrink: 0;
    padding: 0.75rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--background);
  }
</style>
