<script lang="ts">
  // v3's in-app confirm (`workflow-builder/components/ConfirmDeleteDialog.svelte`): title, one sentence, Cancel and the
  // action in the same AlertDialog, used for rollback and "Entwurf verwerfen" instead of the browser's `confirm()`.
  import * as AlertDialog from '@ueberblick/ui/components/ui/alert-dialog';
  import { buttonVariants } from '@ueberblick/ui/components/ui/button';

  interface Props {
    open?: boolean;
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    destructive?: boolean;
    onconfirm: () => void;
  }
  let {
    open = $bindable(false),
    title,
    body,
    confirm,
    cancel,
    destructive = false,
    onconfirm,
  }: Props = $props();
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{body}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{cancel}</AlertDialog.Cancel>
      <AlertDialog.Action
        class={destructive ? buttonVariants({ variant: 'destructive' }) : undefined}
        onclick={() => {
          open = false;
          onconfirm();
        }}
      >
        {confirm}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
