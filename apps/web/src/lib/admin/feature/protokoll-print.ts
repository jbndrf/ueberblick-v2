/**
 * The print stylesheet of a Protokoll (WP-372, "Als PDF exportieren"): the browser's print-to-PDF prints the page
 * without the admin shell (sidebar, top bar), with the scroll containers opened up so a long form runs over pages,
 * and with the print button and page navigation left out. No server PDF service.
 */
export const PROTOKOLL_PRINT_CSS = `@media print {
  [data-slot='sidebar'], [data-slot='sidebar-gap'], [data-slot='sidebar-inset'] > header, .protokoll-noprint { display: none !important; }
  html, body, [data-slot='sidebar-wrapper'], [data-slot='sidebar-inset'], [data-slot='sidebar-inset'] > div {
    height: auto !important; max-height: none !important; overflow: visible !important; }
  [data-slot='sidebar-inset'] { margin: 0 !important; box-shadow: none !important; }
  .protokoll-page { max-width: none !important; padding: 0 !important; }
  .protokoll-page [data-testid='field'] { break-inside: avoid; }
}`;
