<script lang="ts">
  // The one place a hold that needs a person is said out loud (docs/13 principle 8): an incompatible server, an
  // expired sign-in, a stopped sync. It adds no navigation; it disappears when the hold does.
  import type { SyncNotice } from './status';
  import { message, type Locale } from './messages';

  interface Props {
    notice: SyncNotice;
    locale: Locale;
  }
  let { notice, locale }: Props = $props();
</script>

<div class="notice" role="alert" data-notice={notice.kind}>
  <p>{notice.text}</p>
  {#if notice.signIn}<a class="action" href="/login">{message(locale, 'notice_sign_in')}</a>{/if}
</div>

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ub-space-sm) var(--ub-space-md);
    align-items: center;
    padding: var(--ub-space-sm) var(--ub-space-md);
    background: var(--ub-color-status-refused-bg);
    color: var(--ub-color-status-refused-fg);
    border-bottom: 2px solid currentColor;
    font-weight: var(--ub-type-weight-strong);
  }
  p {
    margin: 0;
  }
  .action {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 var(--ub-space-md);
    color: inherit;
    border: 2px solid currentColor;
    border-radius: var(--ub-radius-md);
  }
  .action:focus-visible {
    outline: 3px solid var(--ub-color-focus);
    outline-offset: 2px;
  }
</style>
