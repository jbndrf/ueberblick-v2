<script lang="ts">
  // The Beziehungen page (v3 `relations/+page.svelte:153-256`): header with "Beziehung erstellen", a dashed empty state,
  // or one bordered row per relation (name, Eltern -> Kind, badges, pencil and trash). The Anbindung badge is here;
  // the Geometrie badge and its dialog field follow with B-019 / WP-677. The route passes the load data, api and reload.
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Network from '@lucide/svelte/icons/network';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { Badge } from '@ueberblick/ui/components/ui/badge';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { toast } from '@ueberblick/ui/components/ui/sonner';
  import { notifyDraftChanged } from '../draft/status-store.svelte';
  import { adminMessage, type AdminKey } from '../../../routes/(admin)/admin/shell/messages';
  import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
  import type { RelationsApi } from './api';
  import DeleteRelationDialog from './DeleteRelationDialog.svelte';
  import RelationDialog from './RelationDialog.svelte';
  import { ATTACHMENT, GEOMETRY, MULTIPLICITY, relationLabel } from './labels';
  import type { DeletePreview, RelationRowData, RelationsPageData, RelationValues } from './types';

  let {
    data,
    locale,
    api,
    reload,
  }: {
    data: RelationsPageData;
    locale: Locale;
    api: RelationsApi;
    reload: () => Promise<void>;
  } = $props();

  const t = (key: AdminKey): string => adminMessage(locale, key);
  const pick = (map: Readonly<Record<string, AdminKey>>, key: string): string =>
    relationLabel(locale, map, key);

  let dialogOpen = $state(false);
  let editing = $state<RelationRowData | null>(null);
  let deleteOpen = $state(false);
  let deleting = $state<RelationRowData | null>(null);
  let preview = $state<DeletePreview | null>(null);
  let holding = $state<number | null>(null);

  const typeLabel = (row: RelationRowData, side: 'parent' | 'child'): string =>
    side === 'parent' ? row.parentLabel : row.childLabel;

  function openCreate(): void {
    editing = null;
    dialogOpen = true;
  }

  function openEdit(row: RelationRowData): void {
    editing = row;
    dialogOpen = true;
  }

  /** A relation change is in the draft: the shell's publish bar follows (WP-326), then the list reloads. */
  async function changed(): Promise<void> {
    notifyDraftChanged();
    await reload();
  }

  /** Create or update; a refusal stays in the dialog (and is toasted, as v3 did), done closes it. */
  async function save(values: RelationValues): Promise<string | null> {
    const row = editing;
    const result = row ? await api.update(row.id, values) : await api.create(values);
    if (!result.ok) {
      toast.error(result.message);
      return result.message;
    }
    toast.success(t(row ? 'rel_update_ok' : 'rel_create_ok'));
    dialogOpen = false;
    editing = null;
    await changed();
    return null;
  }

  /** Delete asks first: the Doc's problems and the count of features that hold the relation say what it is used for. */
  async function askDelete(row: RelationRowData): Promise<void> {
    deleting = row;
    preview = null;
    holding = null;
    deleteOpen = true;
    const [seen, count] = await Promise.all([api.preview(row.id), api.holding(row.child, row.refKey)]);
    if (!seen.ok) {
      deleteOpen = false;
      toast.error(seen.message);
      return;
    }
    holding = count;
    preview = seen.value;
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    const result = await api.remove(deleting.id);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(t('rel_delete_ok'));
    deleteOpen = false;
    deleting = null;
    await changed();
  }
</script>

<div class="flex w-full min-w-0 flex-col gap-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-3xl font-bold tracking-tight">{t('rel_title')}</h1>
      <p class="text-muted-foreground">{t('rel_description')}</p>
    </div>
    <Button onclick={openCreate}>
      <Plus class="mr-2 h-4 w-4" />
      {t('rel_create')}
    </Button>
  </div>

  {#if data.relations.length === 0}
    <div
      data-testid="relations-empty"
      class="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center"
    >
      <Network class="h-8 w-8 text-muted-foreground" />
      <p class="font-medium">{t('rel_empty')}</p>
      <p class="text-sm text-muted-foreground">{t('rel_empty_hint')}</p>
    </div>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each data.relations as row (row.id)}
        <li data-relation={row.id} class="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="font-medium">{row.label}</span>
            <span class="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span class="truncate">{typeLabel(row, 'parent')}</span>
              <ArrowRight class="h-3.5 w-3.5 shrink-0" />
              <span class="truncate">{typeLabel(row, 'child')}</span>
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{pick(ATTACHMENT, row.attachment)}</Badge>
            <Badge variant="secondary">{pick(MULTIPLICITY, row.cardinality)}</Badge>
            <Badge variant={row.geometryProblem ? 'destructive' : 'outline'}
              >{pick(GEOMETRY, row.geometry)}</Badge
            >
            {#if row.source === 'template'}
              <Badge variant="outline">{t('rel_from_template')}</Badge>
            {/if}
          </div>
          <div class="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onclick={() => openEdit(row)}>
              <Pencil class="h-4 w-4" />
              <span class="sr-only">{t('rel_edit')}</span>
            </Button>
            <Button variant="ghost" size="icon" class="text-destructive" onclick={() => void askDelete(row)}>
              <Trash2 class="h-4 w-4" />
              <span class="sr-only">{t('rel_delete')}</span>
            </Button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<RelationDialog
  bind:open={dialogOpen}
  {locale}
  types={data.types}
  choices={data.choices}
  relation={editing
    ? {
        name: editing.label,
        parent: editing.parent,
        child: editing.child,
        cardinality: editing.cardinality,
        attachment: editing.attachment,
        onDelete: editing.onDelete,
        geometry: editing.geometry,
      }
    : null}
  geometryProblem={editing?.geometryProblem ?? false}
  onsave={save}
/>

<DeleteRelationDialog bind:open={deleteOpen} {locale} {preview} {holding} onconfirm={confirmDelete} />
