<script lang="ts">
  // The Teilnehmende page (v3 `participants/+page.svelte`): header with the "Gäste anzeigen" switch and "QR exportieren (n)",
  // then one BaseTable: Name, E-Mail, Telefon, Zugangstoken, Rollen, Status and the admin's own columns, an inline add row,
  // a row menu and the column manager behind the "+" of the last header. The route (`+page.svelte`) passes the load data,
  // the api and the two things only it can do: reload and change the URL.
  import KeyRound from '@lucide/svelte/icons/key-round';
  import ShieldOff from '@lucide/svelte/icons/shield-off';
  import UserCog from '@lucide/svelte/icons/user-cog';
  import { BaseTable, CellRefusal, type TableRow } from '@ueberblick/ui/components/admin';
  import { Label } from '@ueberblick/ui/components/ui/label';
  import { Switch } from '@ueberblick/ui/components/ui/switch';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import type { MultiSelectOption } from '@ueberblick/ui/components/ui/multi-select';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { ParticipantsApi } from './api';
  import ColumnManager from './ColumnManager.svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import PersonDialog, { type PersonValues } from './PersonDialog.svelte';
  import QrExportButton from './QrExportButton.svelte';
  import RolesDialog from './RolesDialog.svelte';
  import { exportQrPdf, type BadgeEntry } from './qr-pdf';
  import { KEYS, attrKey, attrValue, loginLink, patchOf, rowsOf, tableColumns } from './table';
  import type { CallResult, CustomColumn, ParticipantsPageData } from './types';

  let {
    data,
    locale,
    origin,
    api,
    reload,
    onGuests,
  }: {
    data: ParticipantsPageData;
    locale: Locale;
    origin: string;
    api: ParticipantsApi;
    reload: () => Promise<void>;
    onGuests: (show: boolean) => void;
  } = $props();

  const t = (key: AdminKey, values?: Record<string, string | number>): string =>
    adminMessage(locale, key, values);

  let table: { getSelectedRows(): TableRow[] } | undefined = $state();
  let selected = $state<readonly string[]>([]);
  let personTarget = $state<TableRow | null>(null);
  let rolesTarget = $state<TableRow | null>(null);
  let deleteTarget = $state<TableRow | null>(null);
  let revokeTarget = $state<TableRow | null>(null);
  let personOpen = $state(false);
  let rolesOpen = $state(false);
  let deleteOpen = $state(false);
  let revokeOpen = $state(false);
  let managerOpen = $state(false);

  const rows = $derived(rowsOf(data.people, data.columns));
  const roleOptions = $derived<MultiSelectOption[]>(
    data.roles.map((r) => ({
      value: r.key,
      label: r.label,
      ...(r.pending ? { description: t('prt_role_new') } : {}),
    })),
  );

  /** Shows the refusal (or `done`) as a toast; true when it worked. A change reloads the roster. */
  async function settle(result: CallResult<unknown>, done: string): Promise<boolean> {
    if (!result.ok) {
      toast.error(result.message);
      return false;
    }
    toast.success(done);
    await reload();
    return true;
  }

  async function createRole(name: string): Promise<{ key: string; label: string; pending: boolean } | null> {
    const result = await api.createRole(name);
    if (!result.ok) {
      toast.error(t('prt_role_error'));
      return null;
    }
    notifyDraftChanged(); // the role is in the draft: the shell's publish bar follows (WP-326)
    return result.value;
  }

  const columns = $derived(
    tableColumns({ locale, origin, roles: data.roles, columns: data.columns, createRole }),
  );

  /** One in-place edit. A refusal is thrown as a `CellRefusal` so the cell keeps what was typed and shows the message. */
  async function edit(id: string, key: string, value: unknown): Promise<void> {
    if (key === KEYS.token) {
      const text = String(value ?? '').trim();
      const result = await api.setToken(id, text === '' ? undefined : text);
      if (!result.ok) throw new CellRefusal(result.message);
      await reload();
      return;
    }
    const patch = patchOf(key, value, data.columns);
    if (!patch) return;
    const result = await api.patch(id, patch);
    if (!result.ok) throw new CellRefusal(result.message);
    await reload();
  }

  /** The inline add row: Name (required), E-Mail, Telefon, Rollen and the admin's columns; the token is made at once, as v3 did. */
  async function add(values: TableRow): Promise<void> {
    const attrs: Record<string, unknown> = {};
    for (const column of data.columns) {
      const typed = attrValue(column.type, values[attrKey(column.key)]);
      if (typed !== null) attrs[column.key] = typed;
    }
    const text = (key: string): string => String(values[key] ?? '').trim();
    const result = await api.add({
      name: text(KEYS.name),
      ...(text(KEYS.email) !== '' ? { email: text(KEYS.email) } : {}),
      ...(text(KEYS.phone) !== '' ? { phone: text(KEYS.phone) } : {}),
      roles: Array.isArray(values[KEYS.roles]) ? (values[KEYS.roles] as unknown[]).map(String) : [],
      attrs,
    });
    if (!result.ok) {
      toast.error(result.message);
      throw new CellRefusal(result.message);
    }
    await api.setToken(result.value.id);
    toast.success(t('prt_create_ok'));
    await reload();
  }

  const defaults = (): TableRow => {
    const out: TableRow = {};
    for (const c of data.columns) if (c.default !== undefined) out[attrKey(c.key)] = c.default;
    return out;
  };
  const requiredKeys = $derived([
    KEYS.name,
    ...data.columns.filter((c: CustomColumn) => c.required === true).map((c) => attrKey(c.key)),
  ]);

  const idOf = (row: TableRow): string => String(row['id']);
  const nameOf = (row: TableRow): string => String(row[KEYS.name] ?? '');

  /** QR exportieren (n): a person without a token gets one first, then the PDF holds the login links. */
  async function exportQr(): Promise<void> {
    const chosen = table?.getSelectedRows() ?? [];
    const entries: BadgeEntry[] = [];
    let made = false;
    for (const row of chosen) {
      let token = String(row[KEYS.token] ?? '');
      if (token === '') {
        const result = await api.setToken(idOf(row));
        if (!result.ok) throw new Error(result.message);
        token = result.value.token;
        made = true;
      }
      entries.push({ name: nameOf(row), link: loginLink(origin, token) });
    }
    await exportQrPdf(entries);
    if (made) await reload();
  }

  async function saveColumns(next: readonly CustomColumn[]): Promise<CallResult<null>> {
    const result = await api.saveColumns(next);
    if (result.ok) {
      toast.success(t('prt_fields_update_ok'));
      await reload();
    }
    return result;
  }
</script>

<div class="flex h-[calc(100svh-4rem)] min-h-[28rem] w-full min-w-0 flex-col gap-6">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">{t('prt_title')}</h1>
      <p class="text-muted-foreground">{t('prt_description')}</p>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2">
        <Switch id="show-guests" checked={data.showGuests} onCheckedChange={(on) => onGuests(on === true)} />
        <Label for="show-guests" class="text-sm">{t('prt_show_guests')}</Label>
      </div>
      <QrExportButton {locale} count={selected.length} run={exportQr} />
    </div>
  </div>

  <BaseTable
    bind:this={table}
    {rows}
    {columns}
    {locale}
    selectable
    shiftSelect
    showToolbar
    showEditMode
    editModeLabel={t('prt_edit_mode')}
    emptyMessage={t('prt_empty')}
    emptySubMessage={t('prt_empty_hint')}
    onSelectionChange={(ids) => (selected = ids)}
    onEdit={edit}
    onAdd={add}
    addRow={{ requiredKeys, excludedKeys: [KEYS.token, KEYS.active], defaultValues: defaults }}
    onDelete={(ids) => {
      deleteTarget = rows.find((r) => idOf(r) === ids[0]) ?? null;
      deleteOpen = deleteTarget !== null;
    }}
    rowMenu={{
      header: t('prt_actions'),
      onEdit: (row) => {
        personTarget = row;
        personOpen = true;
      },
      items: [
        {
          label: t('prt_edit_roles'),
          icon: UserCog,
          onSelect: (row) => {
            rolesTarget = row;
            rolesOpen = true;
          },
        },
        {
          label: t('prt_new_token'),
          icon: KeyRound,
          onSelect: async (row) => {
            const result = await api.setToken(idOf(row));
            await settle(result, t('prt_token_ok'));
          },
        },
        {
          label: t('prt_revoke'),
          icon: ShieldOff,
          destructive: true,
          onSelect: (row) => {
            revokeTarget = row;
            revokeOpen = true;
          },
        },
      ],
    }}
    columnManagement={{ label: t('prt_fields_add'), onOpen: () => (managerOpen = true) }}
  />
</div>

<PersonDialog
  bind:open={personOpen}
  {locale}
  person={personTarget
    ? {
        name: nameOf(personTarget),
        email: String(personTarget[KEYS.email] ?? ''),
        phone: String(personTarget[KEYS.phone] ?? ''),
      }
    : null}
  onsave={async (values: PersonValues) => {
    if (!personTarget) return;
    const result = await api.patch(idOf(personTarget), {
      name: values.name,
      email: values.email.trim() === '' ? null : values.email,
      phone: values.phone.trim() === '' ? null : values.phone,
    });
    if (await settle(result, t('prt_update_ok'))) personOpen = false;
  }}
/>

<RolesDialog
  bind:open={rolesOpen}
  {locale}
  options={roleOptions}
  roles={rolesTarget && Array.isArray(rolesTarget[KEYS.roles]) ? (rolesTarget[KEYS.roles] as string[]) : []}
  createRole={async (name) => {
    const made = await createRole(name);
    if (!made) throw new Error('role not created');
    return {
      value: made.key,
      label: made.label,
      ...(made.pending ? { description: t('prt_role_new') } : {}),
    };
  }}
  onsave={async (roles) => {
    if (!rolesTarget) return;
    const result = await api.patch(idOf(rolesTarget), { roles });
    if (!result.ok) toast.error(t('prt_roles_error'));
    else if (await settle(result, t('prt_update_ok'))) rolesOpen = false;
  }}
/>

<ConfirmDialog
  bind:open={deleteOpen}
  title={t('prt_delete')}
  description={t('prt_delete_confirm')}
  confirmLabel={t('prt_delete_action')}
  cancelLabel={t('prt_cancel')}
  onconfirm={async () => {
    if (!deleteTarget) return;
    const ok = await settle(await api.remove(idOf(deleteTarget)), t('prt_delete_ok'));
    if (ok) deleteOpen = false;
  }}
/>

<ConfirmDialog
  bind:open={revokeOpen}
  title={t('prt_revoke')}
  description={t('prt_revoke_confirm')}
  confirmLabel={t('prt_revoke')}
  cancelLabel={t('prt_cancel')}
  onconfirm={async () => {
    if (!revokeTarget) return;
    const ok = await settle(await api.revokeToken(idOf(revokeTarget)), t('prt_token_revoked'));
    if (ok) revokeOpen = false;
  }}
/>

<ColumnManager
  bind:open={managerOpen}
  {locale}
  columns={data.columns}
  types={data.columnTypes}
  onsave={saveColumns}
/>
