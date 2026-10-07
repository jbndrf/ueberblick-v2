<script lang="ts">
  // v3's inline edit in the Daten tab (detail module :1540-1553: the form renderer in view mode with `editableFieldIds`):
  // the properties the admin picked are inputs in place, every other row stays as it is.
  import { FieldInput, MediaGallery, type FeatureSheetModel, type ToolSlot } from '@ueberblick/ui';
  import type { Json } from '@ueberblick/ui';
  import FieldTool from '../form/FieldTool.svelte';
  import type { Locale } from '../messages';
  import type { QuickEdit } from './quick-edit.svelte';

  interface Props {
    model: FeatureSheetModel;
    locale: Locale;
    edit: QuickEdit;
  }
  let { model, locale, edit }: Props = $props();

  const fieldOf = (key: string) => edit.fields.find((f) => f.key === key);
</script>

{#snippet tool(slot: ToolSlot)}
  <FieldTool {...{ host: edit.host, locale, slot }} />
{/snippet}

<dl class="space-y-3">
  {#each model.rows as row (row.key)}
    {@const field = fieldOf(row.key)}
    <div>
      {#if field}
        <FieldInput
          {field}
          value={edit.values[row.key]}
          {locale}
          required={false}
          readonly={false}
          choices={edit.choices[row.key]}
          {tool}
          onchange={(v: Json) => edit.set(row.key, v)}
        />
      {:else}
        <dt class="text-xs font-medium text-muted-foreground">{row.label}</dt>
        <dd class="text-sm break-words text-foreground" class:text-muted-foreground={row.empty}>
          {#if row.files.length > 0}
            <MediaGallery files={row.files} mode="view" size="list" />
          {:else if row.links.length > 0}
            {row.links.map((l) => l.label).join(', ')}
          {:else}
            {row.text}
          {/if}
        </dd>
      {/if}
    </div>
  {/each}
</dl>
