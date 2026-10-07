<script lang="ts">
  // v3's "Rollen bearbeiten" dialog (`participants/+page.svelte:467-516`): v3's MobileMultiSelect with create-by-typing,
  // Cancel and Save. An existing role applies at once (Q13: participants are not part of the draft); a role typed here is
  // added to the draft by the page (`createRole`).
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';

  let {
    open = $bindable(false),
    locale,
    options,
    roles,
    createRole,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    options: MultiSelectOption[];
    /** The person's role keys when the dialog opens. */
    roles: readonly string[];
    createRole: (name: string) => Promise<MultiSelectOption>;
    onsave: (roles: string[]) => void | Promise<void>;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
  let selected = $state<string[]>([]);
  let choices = $state<MultiSelectOption[]>([]);

  // Start fresh each time the dialog opens, and only then: a role typed into the picker reloads the page data, which hands this
  // component new `roles` and `options` while the admin is still choosing; that must not reset what is picked (WP-346).
  $effect(() => {
    if (open)
      untrack(() => {
        selected = [...roles];
        choices = [...options];
      });
  });

  async function create(name: string): Promise<MultiSelectOption> {
    const made = await createRole(name);
    choices = [...choices, made];
    return made;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('prt_edit_roles')}</Dialog.Title>
    </Dialog.Header>
    <div class="py-4">
      <MultiSelect
        disablePortal
        bind:selected
        bind:options={choices}
        allowCreate
        onCreate={create}
        labels={{ placeholder: t('prt_roles_ph') }}
      />
    </div>
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (open = false)}>{t('prt_cancel')}</Button>
      <Button type="button" onclick={() => void onsave([...selected])}>{t('prt_save')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
