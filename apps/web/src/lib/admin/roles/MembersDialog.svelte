<script lang="ts">
  // v3's "Teilnehmende bearbeiten" dialog (`roles/+page.svelte:612-657`): v3's MobileMultiSelect over the roster with
  // create-by-typing, Abbrechen and Speichern. Save sends one change set (who joined, who left) for the role.
  import { untrack } from 'svelte';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import * as Dialog from '@ueberblick/ui/components/ui/dialog';
  import { MultiSelect, type MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { RolePerson } from './types';

  let {
    open = $bindable(false),
    locale,
    people,
    members,
    createPerson,
    onsave,
  }: {
    open?: boolean;
    locale: Locale;
    people: readonly RolePerson[];
    /** The ids of the people who have the role when the dialog opens. */
    members: readonly string[];
    createPerson: (name: string) => Promise<MultiSelectOption>;
    onsave: (change: { add: string[]; remove: string[] }) => void | Promise<void>;
  } = $props();

  const t = (key: Parameters<typeof adminMessage>[1]): string => adminMessage(locale, key);
  let selected = $state<string[]>([]);
  let choices = $state<MultiSelectOption[]>([]);
  /** Who had the role when the dialog opened: Speichern sends the difference to this. */
  let initial = $state<string[]>([]);

  // Start fresh each time the dialog opens, and only then: a person typed into the picker reloads the page data, which hands
  // this component new `members` and `people` while the admin is still choosing; that must not reset what is picked.
  $effect(() => {
    if (open)
      untrack(() => {
        initial = [...members];
        selected = [...members];
        choices = people.map((p) => ({ value: p.id, label: p.name }));
      });
  });

  async function create(name: string): Promise<MultiSelectOption> {
    const made = await createPerson(name);
    choices = [...choices, made];
    return made;
  }

  function save(): void {
    const before = new Set(initial);
    const now = new Set(selected);
    void onsave({
      add: selected.filter((id) => !before.has(id)),
      remove: initial.filter((id) => !now.has(id)),
    });
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{t('rol_edit_members')}</Dialog.Title>
    </Dialog.Header>
    <div class="py-4">
      <MultiSelect
        disablePortal
        bind:selected
        bind:options={choices}
        allowCreate
        onCreate={create}
        labels={{ placeholder: t('rol_members_ph') }}
      />
    </div>
    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={() => (open = false)}>{t('rol_cancel')}</Button>
      <Button type="button" onclick={save}>{t('rol_save')}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
