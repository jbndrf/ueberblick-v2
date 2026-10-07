<script lang="ts">
  import { isMobile } from '../is-mobile';
</script>

<p data-testid="probe">{isMobile() ? 'phone' : 'desktop'}</p>
