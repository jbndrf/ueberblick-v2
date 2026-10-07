<script lang="ts">
  // A preview login is a session in the project's Vorschau (A-031); the bootstrap says so (`project.preview`, WP-373).
  // The banner is a strip at the top of the shell column like NoticeBar: in the flow, so it covers neither the header,
  // the map controls nor the FAB, and it takes no space when it is not rendered. Not dismissable: a preview stays one.
  import { message, type Locale } from './messages';

  interface Props {
    locale: Locale;
  }
  let { locale }: Props = $props();
</script>

<div class="preview" role="status" data-testid="preview-banner">
  <p>{message(locale, 'preview_banner')}</p>
</div>

<style>
  .preview {
    padding: var(--ub-space-sm) var(--ub-space-md);
    background: var(--ub-color-status-pending-bg);
    color: var(--ub-color-status-pending-fg);
    border-bottom: 2px solid currentColor;
    font-weight: var(--ub-type-weight-strong);
    text-align: center;
  }
  p {
    margin: 0;
  }
</style>
