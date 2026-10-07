import { defineRegistry, type KeyOf } from './define';

/**
 * Image types the project icon (`branding.icon`) may have, and the size cap of that upload (A-036). The key is the
 * media type as sent in `Content-Type`.
 */
export const BRANDING_ICON_TYPES = defineRegistry([
  { key: 'image/png', description: 'PNG.' },
  { key: 'image/jpeg', description: 'JPEG.' },
  { key: 'image/webp', description: 'WebP.' },
  // SVG is accepted unsanitised on purpose: see docs/decisions/later/A-036-branding-and-map-bounds.md.
  { key: 'image/svg+xml', description: 'SVG (safety: A-036).' },
] as const);
export type BrandingIconType = KeyOf<typeof BRANDING_ICON_TYPES>;

/** Largest project icon in bytes (v3: "Max 2MB"). */
export const BRANDING_ICON_MAX_BYTES = 2 * 1024 * 1024;
