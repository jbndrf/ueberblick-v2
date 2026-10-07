<script lang="ts">
  // v3 crud-dialogs.svelte "Delete Dialog" and the field manager's delete dialog: an AlertDialog with Cancel and a red action.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';

  let {
    open = $bindable(false),
    title,
    description,
    confirmLabel,
    cancelLabel,
    onconfirm,
  }: {
    open?: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onconfirm: () => void | Promise<void>;
  } = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{description}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{cancelLabel}</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => void onconfirm()}
        class="text-destructive-foreground bg-destructive hover:bg-destructive/90"
      >
        {confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
