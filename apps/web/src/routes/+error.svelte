<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head><title>{page.status}</title></svelte:head>

<main>
  <h1>{page.status}</h1>
  <!-- Both languages are rendered; the html lang attribute (from Accept-Language, see hooks.server.ts) picks one. -->
  <p lang="de">{page.status === 404 ? 'Diese Seite gibt es nicht.' : 'Etwas ist schiefgegangen.'}</p>
  <p lang="en">{page.status === 404 ? 'This page does not exist.' : 'Something went wrong.'}</p>
  <a href="/"><span lang="de">Zur App</span><span lang="en">Back to the app</span></a>
</main>

<style>
  :global(html:lang(de)) [lang='en'],
  :global(html:lang(en)) [lang='de'] {
    display: none;
  }
</style>
