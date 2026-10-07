/** The name and description of a manifest tool, from the participant catalogue (de/en, WP-586). */
import { message, type Locale, type MessageKey } from '../messages';

const TEXT = {
  chat: { name: 'tool_chat_name', description: 'tool_chat_description' },
  cluster: { name: 'tool_cluster_name', description: 'tool_cluster_description' },
  measure: { name: 'tool_measure_name', description: 'tool_measure_description' },
  search: { name: 'tool_search_name', description: 'tool_search_description' },
  views: { name: 'tool_views_name', description: 'tool_views_description' },
} as const satisfies Record<string, { name: MessageKey; description: MessageKey }>;

type TextKey = keyof typeof TEXT;
const hasText = (key: string): key is TextKey => key in TEXT;

/** The tool's name; the key itself for a tool the catalogue does not know yet. */
export const toolName = (locale: Locale, key: string): string =>
  hasText(key) ? message(locale, TEXT[key].name) : key;

export const toolDescription = (locale: Locale, key: string): string =>
  hasText(key) ? message(locale, TEXT[key].description) : '';

/** The manifest keys the catalogue has text for. */
export const TEXT_KEYS: readonly string[] = Object.keys(TEXT);
