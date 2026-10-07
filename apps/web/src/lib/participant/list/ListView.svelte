<script lang="ts">
  // The Liste: every feature of the view in the map extent, one table per Objektart (WP-711).
  import { FeatureList, type FeatureListLabels } from '@ueberblick/ui';
  import type { FeatureId } from '@ueberblick/core/model';
  import type { RowGroup, GroupRow } from './groups';

  interface Props {
    heading: string;
    groups: readonly RowGroup<GroupRow>[];
    labels: Omit<FeatureListLabels, 'caption' | 'name'>;
    sort: readonly string[];
    onfeature: (id: FeatureId) => void;
  }
  let { heading, groups, labels, sort, onfeature }: Props = $props();
</script>

<h2 class="mb-2 text-sm font-semibold">{heading}</h2>
{#each groups as g (g.type)}
  <div class="mb-6">
    <FeatureList
      features={g.rows}
      columns={g.columns}
      labels={{ ...labels, caption: `${g.label} (${g.rows.length})`, name: g.label }}
      sort={sort.filter((k) => k === '$name' || k.replace(/^-/, '') in (g.rows[0]?.properties ?? {}))}
      onFeatureTap={onfeature}
    />
  </div>
{/each}
