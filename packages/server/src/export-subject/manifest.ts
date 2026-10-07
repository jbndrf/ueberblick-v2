import { z } from '@ueberblick/core/zod';

export const EXPORT_FORMAT = 'ueberblick-subject-export';
export const EXPORT_VERSION = 1;

const LabelSchema = z.union([z.string(), z.record(z.string(), z.string())]);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** `manifest.json` of a subject export: the format the admin hands to the person (Art. 15/20). */
export const ManifestSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  project: z.string().min(1),
  config_version: z.number().int().nonnegative(),
  generated_at: z.string(),
  subject: z.strictObject({ id: z.string().min(1) }),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      kind: z.enum(['participant', 'observations', 'runs', 'messages', 'features', 'blob']),
      records: z.number().int().nonnegative().optional(),
      bytes: z.number().int().nonnegative(),
      sha256: Sha256.optional(),
      mime: z.string().optional(),
    }),
  ),
  properties: z
    .array(
      z.strictObject({
        type: z.string(),
        property: z.string(),
        subject: z.string(),
        label: LabelSchema.optional(),
      }),
    )
    .describe(
      'The personal properties of the config version, with their labels, so the files read without the app.',
    ),
  missing_blobs: z.array(Sha256),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export function manifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ManifestSchema, { target: 'draft-7' }) as Record<string, unknown>;
}
