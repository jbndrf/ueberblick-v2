import { z } from '../zod';
import { LocalizedStringSchema } from './primitives';

/** `branding.icon`: the sha-256 of an uploaded image in the project's blob store (A-036). */
export const BlobShaSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'a sha-256 as 64 lowercase hex digits')
  .describe('The sha-256 of a blob in the project.');

/** How participants see the project: the name and the icon (v3 `display_name` and `icon`). */
export const BrandingSchema = z
  .strictObject({
    name: LocalizedStringSchema.optional().describe(
      'The name participants see; absent means the project name.',
    ),
    icon: BlobShaSchema.optional().describe(
      'The project icon: the sha-256 of an image blob (type and size from the registry), served to every participant.',
    ),
  })
  .describe('The project as participants see it (A-036).');
export type Branding = z.infer<typeof BrandingSchema>;
