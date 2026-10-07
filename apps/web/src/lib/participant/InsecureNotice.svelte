<script lang="ts">
  // The page was opened over plain http, so the device runtime cannot start (Web Locks need a secure context).
  // Says so and names the https address; it offers no reload, since reloading over http fails the same way.
  import { message, type Locale } from './messages';

  interface Props {
    locale: Locale;
    address: string;
  }
  let { locale, address }: Props = $props();
</script>

<div role="alert" data-notice="insecure_context">
  <p>{message(locale, 'insecure_context')}</p>
  <p>{message(locale, 'insecure_address', { address })}</p>
</div>
