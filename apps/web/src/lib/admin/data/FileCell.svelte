<script lang="ts">
  // A file property's cell (v3 `fileCellRenderer`, `+page.svelte:797-830`): a 32 px thumbnail per image (a click opens
  // the lightbox), a type chip per other file, and the count when there are several; "-" when there is none.
  import FileText from '@lucide/svelte/icons/file-text';

  interface FileRef {
    readonly sha256: string;
    readonly name: string;
    readonly mime: string;
  }
  let {
    project,
    value,
    onImage,
  }: { project: string; value: unknown; onImage: (url: string, name: string) => void } = $props();

  const files = $derived(
    Array.isArray(value) ? (value as FileRef[]).filter((f) => typeof f?.sha256 === 'string') : [],
  );
  const url = (f: FileRef): string => `/api/p/${encodeURIComponent(project)}/blobs/${f.sha256}`;
  const ext = (f: FileRef): string => f.name.split('.').pop() ?? '';
</script>

{#if files.length > 0}
  <div class="flex items-center gap-1">
    {#each files as file (file.sha256)}
      {#if file.mime.startsWith('image/')}
        <button
          type="button"
          class="h-8 w-8 flex-shrink-0 overflow-hidden rounded border border-border transition-shadow hover:ring-2 hover:ring-primary"
          onclick={(e) => {
            e.stopPropagation();
            onImage(url(file), file.name);
          }}
        >
          <img src="{url(file)}?thumb=list" alt={file.name} class="h-full w-full object-cover" />
        </button>
      {:else}
        <a
          href={url(file)}
          target="_blank"
          rel="noopener"
          class="flex h-8 flex-shrink-0 items-center gap-1 rounded border border-border px-2 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          title={file.name}
          onclick={(e) => e.stopPropagation()}
        >
          <FileText class="h-3 w-3" />
          <span class="max-w-[60px] truncate">{ext(file)}</span>
        </a>
      {/if}
    {/each}
    {#if files.length > 1}
      <span class="text-xs text-muted-foreground">{files.length}</span>
    {/if}
  </div>
{:else}
  <span class="text-xs text-muted-foreground">-</span>
{/if}
