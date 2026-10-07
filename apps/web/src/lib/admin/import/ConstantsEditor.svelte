<script lang="ts">
  // 'Wert für alle Zeilen' (register row 88): other properties than the stage that get one value in every row. The
  // stage has its own select above the table, as v3's 'In Stufe importieren'. Properties already filled from a column
  // are not offered (a constant would override the column).
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '@ueberblick/ui/components/ui/button';
  import { Input } from '@ueberblick/ui/components/ui/input';
  import type { T } from './i18n';
  import { SELECT_CLASS } from './i18n';
  import type { ConstantRow } from './mapping';
  import type { ImportConstant } from './setup';

  let {
    t,
    available,
    rows = $bindable(),
  }: { t: T; available: readonly ImportConstant[]; rows: readonly ConstantRow[] } = $props();

  const used = $derived(new Set(rows.map((r) => r.key)));
  const def = (key: string): ImportConstant | undefined => available.find((c) => c.key === key);
  const free = (key: string): ImportConstant[] => available.filter((c) => !used.has(c.key) || c.key === key);
  const canAdd = $derived(available.some((c) => !used.has(c.key)));

  function add(): void {
    const next = available.find((c) => !used.has(c.key));
    if (next) rows = [...rows, { key: next.key, value: next.kind === 'boolean' ? 'true' : '' }];
  }
  function setKey(i: number, key: string): void {
    rows = rows.map((r, j) => (j === i ? { key, value: def(key)?.kind === 'boolean' ? 'true' : '' } : r));
  }
  function setValue(i: number, value: string): void {
    rows = rows.map((r, j) => (j === i ? { ...r, value } : r));
  }
</script>

{#if available.length > 0}
  <div class="space-y-2" data-testid="import-constants">
    <div>
      <p class="text-sm font-medium">{t('import_constants_title')}</p>
      <p class="text-xs text-muted-foreground">{t('import_constants_hint')}</p>
    </div>
    {#each rows as row, i (i)}
      {@const kind = def(row.key)}
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          class={SELECT_CLASS}
          aria-label={t('import_constants_property')}
          value={row.key}
          onchange={(e) => setKey(i, (e.target as HTMLSelectElement).value)}
        >
          {#each free(row.key) as c (c.key)}
            <option value={c.key}>{c.label}</option>
          {/each}
        </select>
        {#if kind?.kind === 'select' || kind?.kind === 'role'}
          <select
            class={SELECT_CLASS}
            aria-label={t('import_constants_value')}
            value={row.value}
            onchange={(e) => setValue(i, (e.target as HTMLSelectElement).value)}
          >
            <option value="">{t('import_constants_choose')}</option>
            {#each kind.options as o (o.value)}
              <option value={o.value}>{o.label}</option>
            {/each}
          </select>
        {:else if kind?.kind === 'boolean'}
          <select
            class={SELECT_CLASS}
            aria-label={t('import_constants_value')}
            value={row.value}
            onchange={(e) => setValue(i, (e.target as HTMLSelectElement).value)}
          >
            <option value="true">{t('import_yes')}</option>
            <option value="false">{t('import_no')}</option>
          </select>
        {:else}
          <Input
            aria-label={t('import_constants_value')}
            type={kind?.kind === 'date' ? 'date' : 'text'}
            inputmode={kind?.kind === 'number' || kind?.kind === 'integer' ? 'decimal' : undefined}
            value={row.value}
            oninput={(e: Event) => setValue(i, (e.target as HTMLInputElement).value)}
          />
        {/if}
        <Button
          variant="ghost"
          size="icon"
          class="shrink-0 self-end sm:self-auto"
          aria-label={t('import_constants_remove')}
          onclick={() => (rows = rows.filter((_, j) => j !== i))}
        >
          <X class="size-4" />
        </Button>
      </div>
    {/each}
    {#if canAdd}
      <Button variant="outline" size="sm" onclick={add}>
        <Plus class="mr-1.5 size-4" />
        {t('import_constants_add')}
      </Button>
    {/if}
  </div>
{/if}
