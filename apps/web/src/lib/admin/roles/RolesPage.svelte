<script lang="ts">
  // The Rollen page (v3 `roles/+page.svelte:387-657`): header, a one-tab strip, then one BaseTable (Rollenname, Beschreibung,
  // Selbstbeitritt switch, Zugewiesene Teilnehmende) with an inline add row, a row menu (Bearbeiten, Teilnehmende
  // bearbeiten, Beitritts-URL & Voreinstellungen anzeigen, Löschen) and
  // selection delete. Permissions are not set here: they live in the builder (v3 says so in a comment at :394-395).
  // The route (`+page.svelte`) passes the load data, the api and the reload.
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import Link from '@lucide/svelte/icons/link';
  import Users from '@lucide/svelte/icons/users';
  import { BaseTable, CellRefusal, type TableRow } from '@ueberblick/ui/components/admin';
  import * as Tabs from '@ueberblick/ui/components/ui/tabs';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import type { MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { RolesApi } from './api';
  import DeleteRolesDialog from './DeleteRolesDialog.svelte';
  import JoinDialog from './JoinDialog.svelte';
  import MembersDialog from './MembersDialog.svelte';
  import RoleDialog, { type RoleValues } from './RoleDialog.svelte';
  import { KEYS, rowsOf, tableColumns } from './table';
  import type { CallResult, DeletePreview, RolesPageData } from './types';

  let {
    data,
    locale,
    api,
    reload,
  }: {
    data: RolesPageData;
    locale: Locale;
    api: RolesApi;
    reload: () => Promise<void>;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let tab = $state('roles');
  let editTarget = $state<TableRow | null>(null);
  let editOpen = $state(false);
  let membersTarget = $state<TableRow | null>(null);
  let membersOpen = $state(false);
  let deleteKeys = $state<readonly string[]>([]);
  let deletePreview = $state<DeletePreview | null>(null);
  let deleteOpen = $state(false);
  let joinKey = $state<string | null>(null);
  let joinOpen = $state(false);

  const rows = $derived(rowsOf(data.roles));
  const columns = $derived(tableColumns(locale));
  const keyOf = (row: TableRow): string => String(row['id']);
  const joinRole = $derived(data.roles.find((r) => r.key === joinKey) ?? null);
  const membersOf = (key: string): readonly string[] => data.roles.find((r) => r.key === key)?.members ?? [];

  /** A role change is in the draft: the shell's publish bar follows (WP-326), then the list reloads. */
  async function changed(): Promise<void> {
    notifyDraftChanged();
    await reload();
  }

  /** Shows the refusal as a toast, or the reload and then `done` (the toast says the list is already current; WP-497); true when it worked. */
  async function settle(result: CallResult<unknown>, done: string): Promise<boolean> {
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    await changed();
    toast.success(done);
    return true;
  }

  /** One in-place edit. A refusal is thrown as a `CellRefusal` so the cell keeps what was typed and shows the message. */
  async function edit(id: string, key: string, value: unknown): Promise<void> {
    if (key === KEYS.selfJoin) return toggleSelfJoin(id, value === true);
    const text = String(value ?? '');
    const result = await api.update(id, key === KEYS.name ? { name: text } : { description: text });
    if (!result.ok) throw new CellRefusal(result.message);
    await changed();
  }

  /** v3 `toggleSelfJoinable`: applies at once, not in the draft (Q14), so no publish bar; a toast says what happened. */
  async function toggleSelfJoin(id: string, enabled: boolean): Promise<void> {
    const result = await api.setSelfJoin(id, enabled);
    if (!result.ok) {
      toast.error(t('rol_self_join_error'));
      throw new CellRefusal(t('rol_self_join_error'));
    }
    await reload();
    toast.success(t(enabled ? 'rol_self_join_on' : 'rol_self_join_off'));
  }

  /** v3 `openJoinInfo`: the dialog needs a link that is on; otherwise the row says to switch it on first. */
  function openJoin(row: TableRow): void {
    const role = data.roles.find((r) => r.key === keyOf(row));
    if (!role?.selfJoin?.enabled) {
      toast.error(t('rol_self_join_not_enabled'));
      return;
    }
    joinKey = role.key;
    joinOpen = true;
  }

  /** The quota is config: a draft edit, so the publish bar follows (WP-326). */
  async function saveQuota(quota: number): Promise<boolean> {
    if (!joinKey) return false;
    const result = await api.setQuota(joinKey, quota);
    if (!result.ok) {
      toast.error(result.message || t('rol_quota_save_error'));
      return false;
    }
    await changed();
    toast.success(t('rol_quota_saved'));
    return true;
  }

  /** The inline add row: Rollenname (required) and Beschreibung. */
  async function add(values: TableRow): Promise<void> {
    const result = await api.create(String(values[KEYS.name] ?? ''), String(values[KEYS.description] ?? ''));
    if (!result.ok) {
      toast.error(result.message);
      throw new CellRefusal(result.message);
    }
    await changed();
    toast.success(t('rol_create_ok'));
  }

  /** Delete asks first: the Doc's problems and the roster say what the role is still used for. */
  async function askDelete(ids: readonly string[]): Promise<void> {
    deleteKeys = ids;
    deletePreview = null;
    deleteOpen = true;
    const preview = await api.preview(ids);
    if (!preview.ok) {
      deleteOpen = false;
      toast.error(preview.message);
      return;
    }
    deletePreview = preview.value;
  }

  async function createPerson(name: string): Promise<MultiSelectOption> {
    const made = await api.createPerson(name);
    if (!made.ok) {
      toast.error(t('rol_person_error'));
      throw new Error(made.message);
    }
    await reload();
    return { value: made.value.id, label: name };
  }
</script>

<div class="flex h-[calc(100svh-4rem)] min-h-[28rem] w-full min-w-0 flex-col gap-6">
  <div>
    <h1 class="text-3xl font-bold tracking-tight">{t('rol_title')}</h1>
    <p class="text-muted-foreground">{t('rol_description')}</p>
  </div>

  <Tabs.Root bind:value={tab} class="min-h-0 flex-1">
    <Tabs.List>
      <Tabs.Trigger value="roles" class="flex items-center gap-2">
        <ShieldCheck class="h-4 w-4" />
        {t('rol_tab')}
      </Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="roles" class="flex min-h-0 flex-1 flex-col">
      <BaseTable
        {rows}
        {columns}
        {locale}
        selectable
        shiftSelect
        showToolbar
        showEditMode
        editModeLabel={t('rol_edit_mode')}
        emptyMessage={t('rol_empty')}
        emptySubMessage={t('rol_empty_hint')}
        onEdit={edit}
        onAdd={add}
        addRow={{ requiredKeys: [KEYS.name], excludedKeys: [KEYS.selfJoin, KEYS.members] }}
        onDelete={(ids) => void askDelete(ids)}
        rowMenu={{
          header: t('rol_actions'),
          onEdit: (row) => {
            editTarget = row;
            editOpen = true;
          },
          items: [
            {
              label: t('rol_edit_members'),
              icon: Users,
              onSelect: (row) => {
                membersTarget = row;
                membersOpen = true;
              },
            },
            { label: t('rol_self_join_show_url'), icon: Link, onSelect: openJoin },
          ],
        }}
      />
    </Tabs.Content>
  </Tabs.Root>
</div>

<RoleDialog
  bind:open={editOpen}
  {locale}
  role={editTarget
    ? {
        name: String(editTarget[KEYS.name] ?? ''),
        description: String(editTarget[KEYS.description] ?? ''),
      }
    : null}
  onsave={async (values: RoleValues) => {
    if (!editTarget) return;
    const result = await api.update(keyOf(editTarget), values);
    if (await settle(result, t('rol_update_ok'))) editOpen = false;
  }}
/>

<JoinDialog
  bind:open={joinOpen}
  {locale}
  role={joinRole?.selfJoin
    ? { label: joinRole.label, slug: joinRole.selfJoin.slug, quota: joinRole.quota, home: joinRole.home }
    : null}
  origin={typeof window === 'undefined' ? '' : window.location.origin}
  onsavequota={saveQuota}
/>

<MembersDialog
  bind:open={membersOpen}
  {locale}
  people={data.people}
  members={membersTarget ? membersOf(keyOf(membersTarget)) : []}
  {createPerson}
  onsave={async ({ add: joined, remove: left }) => {
    if (!membersTarget) return;
    const result = await api.setMembers(keyOf(membersTarget), joined, left);
    if (!result.ok) toast.error(t('rol_members_error'));
    else if (await settle(result, t('rol_members_ok'))) membersOpen = false;
  }}
/>

<DeleteRolesDialog
  bind:open={deleteOpen}
  {locale}
  preview={deletePreview}
  onconfirm={async () => {
    const result = await api.remove(deleteKeys);
    if (!result.ok) toast.error(t('rol_delete_error'));
    else if (await settle(result, t('rol_delete_ok'))) deleteOpen = false;
  }}
/>
