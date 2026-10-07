// "Wird in Downloads gespeichert..." (v3 `package-selector.svelte:242` savePackToDownloads): hands a Blob to the browser as
// a download. The Blob is the lazy file over the stored layers (WP-668), so a large pack is not read into memory here.
export function saveToDownloads(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser time to start reading the (possibly large) file before revoking, as v3 does.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
