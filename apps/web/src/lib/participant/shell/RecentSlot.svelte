<script lang="ts">
  // The `recent` slot: Zuletzt (v3 `RecentSheet`), the right-hand sheet with the newest Objekte on this device. A row
  // flies to the Objekt on the map (when it has a position) and opens its sheet. The rows are computed once per
  // opening of the sheet (WP-622, R14).
  import type { FeatureId } from '@ueberblick/core/model';
  import { activityFor } from '../feature/sheet-data';
  import { recentFly } from '../sheets/recent/fly';
  import type { RecentRow } from '../sheets/recent/recent';
  import { anchorOfFeature, recentFeatures, withActivity } from '../sheets/recent/recent';
  import RecentSheet from '../sheets/recent/RecentSheet.svelte';
  import { isMobile } from '@ueberblick/ui';
  import { visibleOf } from '../sheets/filter/filtered-source';
  import { recordViewPassOf } from '../sheets/filter/view-pass';
  import type { SheetProps } from './sheets';

  let { ctx, onclose }: SheetProps = $props();
  const { device, locale } = $derived(ctx);

  // Zuletzt lists what the map shows: the same filter predicate, the active view included (WP-808, R1).
  const visible = $derived(
    visibleOf(device.feature, device.classified, ctx.filter, recordViewPassOf(device, ctx.record)),
  );
  const base = $derived(
    recentFeatures({
      visible,
      facts: device.store.facts,
      config: device.classified,
      labelOf: (state) => device.reader.labelOf(state, locale),
      locale,
    }),
  );

  // The newest entry and stage of each row come from the runs on the device: only the rows shown are warmed, once per
  // opening (WP-685, R14); until then the row shows its name and type.
  let rows = $state.raw<readonly RecentRow[]>([]);
  $effect(() => {
    const shown = base;
    rows = shown;
    let live = true;
    void Promise.all(shown.map((r) => device.reader.warmActivity(r.id).catch(() => undefined))).then(() => {
      if (!live) return;
      rows = withActivity(
        shown,
        {
          activityOf: (id) => activityFor(device, id, locale),
          updatedAt: (id) => device.reader.sheetInput(id, locale)?.updatedAt,
        },
        locale,
      );
    });
    return () => (live = false);
  });

  function open(id: FeatureId): void {
    const anchor = anchorOfFeature({ config: device.config, geo: device.geo }, device.feature(id));
    if (anchor !== undefined)
      ctx.map?.centerOn(
        anchor,
        recentFly({ phone: isMobile(), innerHeight: window.innerHeight, recentOpen: true }),
      );
    ctx.openFeature(id);
  }
</script>

<RecentSheet
  open={true}
  {rows}
  {locale}
  now={device.clock.now()}
  besideDetail={ctx.detailOpen}
  onopen={open}
  {onclose}
/>
