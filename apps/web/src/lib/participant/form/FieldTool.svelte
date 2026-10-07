<script lang="ts">
  // The tool of one field (photo, search, geometry ...) inside a form: the tool host of this device and task, mounted for
  // the slot the form renderer hands over. Shared by the multi-step flow and the inline quick edit.
  import { ToolMount } from '@ueberblick/ui';
  import type { ToolHost, ToolSlot } from '@ueberblick/ui';
  import type { Locale } from '../messages';

  interface Props {
    host: ToolHost;
    locale: Locale;
    slot: ToolSlot;
  }
  let { host, locale, slot }: Props = $props();
</script>

<!-- `slot` is a reserved attribute name on a component, so the props go in as one object -->
<ToolMount {...{ host, locale, slot }} />
