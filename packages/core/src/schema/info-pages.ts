import { z } from '../zod';
import { KeySchema, LocalizedStringSchema } from './primitives';

/**
 * An info page (v3 "Infoseite", `InfoPagesSection.svelte`): a help text the admin gives participants inside the
 * app. The content is HTML; the device sanitises it on display with the one sanitiser the legal pages use (R1).
 * As in v3 there is no per-role visibility.
 */
export const InfoPageSchema = z
  .strictObject({
    title: LocalizedStringSchema.describe('The name shown in the Einstellungen sheet.'),
    content: LocalizedStringSchema.describe('The text as HTML; sanitised on display.'),
    sort_order: z
      .number()
      .optional()
      .describe('Lower numbers come first; equal or absent ones keep the authored order.'),
  })
  .describe('An info page: a help text with a title and sanitised HTML content.');
export type InfoPage = z.infer<typeof InfoPageSchema>;

export const InfoPagesSchema = z
  .record(KeySchema, InfoPageSchema)
  .describe('Info pages by key; shown to every participant of the project.');

/** The info pages in sort order (stable: equal or absent orders keep the authored order). The one ordering, for the participant bootstrap and the admin list alike (R1). */
export function orderedInfoPages(
  pages: Readonly<Record<string, InfoPage>> | undefined,
): readonly { readonly key: string; readonly page: InfoPage; readonly sortOrder: number }[] {
  return Object.entries(pages ?? {})
    .map(([key, page], i) => ({ key, page, sortOrder: page.sort_order ?? 0, i }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.i - b.i)
    .map(({ key, page, sortOrder }) => ({ key, page, sortOrder }));
}
