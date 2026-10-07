<script lang="ts">
  // v3's edit dialog (crud-dialogs.svelte "Edit Dialog", fields Name, E-Mail, Telefon of `participants/+page.svelte:104-125`),
  // opened by "Teilnehmende bearbeiten" in the row menu. Name is required (Q12).
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';

  export interface PersonValues {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
  }

  let {
    open = $bindable(false),
    locale,
    person,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    person: PersonValues | null;
    onsave: (values: PersonValues) => void | Promise<void>;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
  let values = $state<PersonValues>({ name: '', email: '', phone: '' });
  let touched = $state(false);
  const uid = $props.id();

  // Fresh values each time the dialog opens for a person.
  $effect(() => {
    if (open && person) {
      values = { ...person };
      touched = false;
    }
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    touched = true;
    if (values.name.trim() === '') return;
    void onsave({ ...values });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('prt_edit')}</Dialog.Title>
    </Dialog.Header>
    <form onsubmit={submit} novalidate>
      <div class="grid gap-4 py-4">
        <div class="grid gap-2">
          <Label for="{uid}-name">{t('prt_col_name')}</Label>
          <Input
            id="{uid}-name"
            bind:value={values.name}
            placeholder={t('prt_name_ph')}
            required
            aria-invalid={touched && values.name.trim() === '' ? 'true' : undefined}
          />
          {#if touched && values.name.trim() === ''}
            <p role="alert" class="text-sm text-destructive">{t('prt_name_required')}</p>
          {/if}
        </div>
        <div class="grid gap-2">
          <Label for="{uid}-email">{t('prt_col_email')}</Label>
          <Input id="{uid}-email" type="email" bind:value={values.email} placeholder={t('prt_email_ph')} />
        </div>
        <div class="grid gap-2">
          <Label for="{uid}-phone">{t('prt_col_phone')}</Label>
          <Input id="{uid}-phone" bind:value={values.phone} placeholder={t('prt_phone_ph')} />
        </div>
      </div>
      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>{t('prt_cancel')}</Button>
        <Button type="submit">{t('prt_save')}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
