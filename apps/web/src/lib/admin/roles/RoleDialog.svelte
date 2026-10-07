<script lang="ts">
  // v3's edit dialog (crud-dialogs.svelte "Edit Dialog" with the fields of `roles/+page.svelte:197-216`: Rollenname,
  // Beschreibung as a 3-row textarea), opened by "Bearbeiten" in the row menu.
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Textarea } from '@ueberblick/ui/components/ui/textarea';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import { MIN_NAME } from './limits';

  export interface RoleValues {
    readonly name: string;
    readonly description: string;
  }

  let {
    open = $bindable(false),
    locale,
    role,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    role: RoleValues | null;
    onsave: (values: RoleValues) => void | Promise<void>;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
  let values = $state<RoleValues>({ name: '', description: '' });
  let touched = $state(false);
  const uid = $props.id();
  const short = $derived(values.name.trim().length < MIN_NAME);

  // Fresh values each time the dialog opens for a role.
  $effect(() => {
    if (open && role) {
      values = { ...role };
      touched = false;
    }
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    touched = true;
    if (short) return;
    void onsave({ ...values });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('rol_edit')}</Dialog.Title>
    </Dialog.Header>
    <form onsubmit={submit} novalidate>
      <div class="grid gap-4 py-4">
        <div class="grid gap-2">
          <Label for="{uid}-name">{t('rol_name')}</Label>
          <Input
            id="{uid}-name"
            bind:value={values.name}
            placeholder={t('rol_name_ph')}
            required
            aria-invalid={touched && short ? 'true' : undefined}
          />
          {#if touched && short}
            <p role="alert" class="text-sm text-destructive">{t('rol_err_name_short')}</p>
          {/if}
        </div>
        <div class="grid gap-2">
          <Label for="{uid}-description">{t('rol_description_field')}</Label>
          <Textarea
            id="{uid}-description"
            bind:value={values.description}
            placeholder={t('rol_description_ph')}
            rows={3}
          />
        </div>
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('rol_cancel')}</Button>
        <Button type="submit">{t('rol_save')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
