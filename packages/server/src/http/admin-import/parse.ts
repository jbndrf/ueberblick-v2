/** The multipart body of the import endpoints: `file`, `mapping` (JSON), and for the import `mode` and `replace`. */
import { IMPORT_LIMITS, type GeoSourceCrs, type Json } from '@ueberblick/core';
import { z } from '@ueberblick/core/zod';
import {
  IMPORT_FORMATS,
  IMPORT_MODES,
  type ImportFormat,
  type ImportMapping,
  type ImportMode,
} from '../../io';

const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

const MappingSchema = z.object({
  task: z.string().min(1),
  type: z.string().min(1).optional(),
  fields: z.record(
    z.string(),
    z.union([z.string(), z.object({ column: z.string(), language: z.string().optional() })]),
  ),
  constants: z.record(z.string(), jsonValue).optional(),
  geometry: z
    .object({
      field: z.string(),
      x: z.string().optional(),
      y: z.string().optional(),
      z: z.string().optional(),
    })
    .optional(),
  sourceCrs: z.string().optional(),
  layer: z.string().optional(),
  delimiter: z.string().optional(),
});

export interface ParsedImport {
  readonly format: ImportFormat;
  readonly bytes: Uint8Array;
  readonly mapping: ImportMapping;
  readonly mode: ImportMode | undefined;
  readonly replace: boolean;
}

export type ParseResult =
  | { readonly ok: true; readonly value: ParsedImport }
  | { readonly ok: false; readonly code: 'file_too_large' | 'invalid_import'; readonly message: string };

const EXTENSIONS: Readonly<Record<string, ImportFormat>> = {
  csv: 'csv',
  geojson: 'geojson',
  json: 'geojson',
  gpkg: 'geopackage',
  geopackage: 'geopackage',
};

const fail = (code: 'file_too_large' | 'invalid_import', message: string): ParseResult => ({
  ok: false,
  code,
  message,
});

export async function parseImport(
  request: Request,
  max: number = IMPORT_LIMITS.maxFileBytes,
): Promise<ParseResult> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > max + 1_000_000) return fail('file_too_large', `The upload is over ${max} bytes.`);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail('invalid_import', 'The body must be multipart/form-data with a file and a mapping.');
  }
  const file = form.get('file');
  if (!(file instanceof File)) return fail('invalid_import', "The field 'file' is missing.");
  if (file.size > max) return fail('file_too_large', `The file is over ${max} bytes.`);
  const rawMapping = form.get('mapping');
  if (typeof rawMapping !== 'string') return fail('invalid_import', "The field 'mapping' is missing.");
  let mapping: z.infer<typeof MappingSchema>;
  try {
    const parsed = MappingSchema.safeParse(JSON.parse(rawMapping));
    if (!parsed.success)
      return fail('invalid_import', `The mapping is malformed: ${parsed.error.issues[0]?.message ?? ''}`);
    mapping = parsed.data;
  } catch {
    return fail('invalid_import', "The field 'mapping' is not JSON.");
  }
  const named = form.get('format');
  const format =
    typeof named === 'string' ? named : EXTENSIONS[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (format === undefined || !IMPORT_FORMATS.has(format))
    return fail(
      'invalid_import',
      'The format is unknown: name it as the field `format` (csv, geojson, geopackage).',
    );
  const mode = form.get('mode');
  if (typeof mode === 'string' && !IMPORT_MODES.has(mode))
    return fail('invalid_import', `'${mode}' is not an import mode.`);
  const { sourceCrs, ...rest } = mapping;
  return {
    ok: true,
    value: {
      format,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mapping: {
        ...rest,
        ...(sourceCrs === undefined ? {} : { sourceCrs: sourceCrs as GeoSourceCrs }),
      } as ImportMapping,
      mode: typeof mode === 'string' && IMPORT_MODES.has(mode) ? mode : undefined,
      replace: form.get('replace') === 'true',
    },
  };
}
