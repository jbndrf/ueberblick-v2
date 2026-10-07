<script lang="ts">
  // v3's "Felder werden geleert" dialog (reference FormFillTool.svelte:445-501): before a submit that erases stored
  // values it lists the fields; "Leeren & speichern" goes on, "Abbrechen" returns to the form.
  import * as AlertDialog from '../components/ui/alert-dialog';
  import { m } from '../paraglide/messages.js';
  import type { ClearedField } from './contract';

  interface Props {
    fields: readonly ClearedField[];
    onconfirm: () => void;
    oncancel: () => void;
  }
  let { fields, onconfirm, oncancel }: Props = $props();
</script>

<AlertDialog.Root open={true} onOpenChange={(open) => !open && oncancel()}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m.form_clear_title()}</AlertDialog.Title>
      <AlertDialog.Description>{m.form_clear_description()}</AlertDialog.Description>
    </AlertDialog.Header>
    <ul class="my-2 list-disc pl-5 text-sm text-foreground">
      {#each fields as f (f.key)}<li>{f.label}</li>{/each}
    </ul>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m.form_cancel()}</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={onconfirm}>
        {m.form_clear_confirm()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
