import { z } from '../zod';
import { parseKeyPath } from '../template/paths';

/** Shared building blocks of the project file schema (docs/05-config-format.md). */

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** A config key: the contract with data and templates, never renamed (F1). */
export const KeySchema = z
  .string()
  .regex(KEY_PATTERN, 'a key matches ^[a-z][a-z0-9_]*$')
  .describe(
    'A config key. Lowercase letters, digits and underscores, starting with a letter. Never renamed.',
  );

/**
 * A key of a task's `form` (A-047): a property key of the task subject, or `<bind>.<property>`, a property of
 * the Objekt the task binds under that name. Only `form` keys have the path shape; `KeySchema` stays strict.
 */
export const FormKeySchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/,
    'a form key is a property key, or <bind>.<property> for a property of a bound Objekt',
  )
  .describe(
    'A property key of the task subject, or `<bind>.<property>`: a property of the Objekt that `bind` names.',
  );

/** A key of an option value. Letter first like every key, so object order equals authored order (A-004 item 11). */
export const OptionKeySchema = z
  .string()
  .regex(KEY_PATTERN, 'an option key matches ^[a-z][a-z0-9_]*$')
  .describe('The stored value of one option of a select property. Letter first, e.g. v3 for the label 3.');

/**
 * A key path into the project file (A-005): dot-separated bare keys; any other segment is a bracketed
 * JSON string, e.g. `views.karte.layers.baeume.style["circle-color"]`. The grammar lives in
 * `template/paths.ts` (`parseKeyPath`), the one implementation (R1).
 */
const SEGMENT = String.raw`(?:\.[a-z][a-z0-9_]*|\["(?:[^"\\]|\\.)*"\])`;
const KEY_PATH_HINT = new RegExp(String.raw`^(?:[a-z][a-z0-9_]*|\["(?:[^"\\]|\\.)*"\])${SEGMENT}*$`);

export const KeyPathSchema = z
  .string()
  .regex(KEY_PATH_HINT, 'a key path') // a hint that shows up in the JSON Schema; parseKeyPath decides
  .refine(
    (p) => parseKeyPath(p) !== undefined,
    'a key path: bare keys joined by dots, other segments as ["json string"]',
  )
  .describe(
    'A path into the project file, e.g. types.baum.properties.vitalitaet or style["circle-color"] (segments that are not keys are bracketed JSON strings).',
  );

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

/** `"Baum"` or `{ de: "Baum", en: "Tree" }` (F12). */
export const LocalizedStringSchema = z
  .union([
    z.string().min(1),
    z
      .record(z.string().regex(LANGUAGE, 'a language tag such as de or en-GB'), z.string())
      .refine((r) => Object.keys(r).length > 0, 'at least one language'),
  ])
  .describe('A label: a plain string, or an object keyed by language tag ({ de: "Baum", en: "Tree" }).');
export type LocalizedString = z.infer<typeof LocalizedStringSchema>;

/** An expression in the rule language (docs/06). Only its shape is checked here; WP-020/013 parse and type it. */
export const ExprSchema = z
  .string()
  .min(1)
  .describe('An expression in the rule language (a CEL subset). Type-checked by compile().');

export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'a semantic version such as 1.0.0')
  .describe('A semantic version (major.minor.patch).');

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

/** Any JSON value. */
export const JsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonSchema),
    z.record(z.string(), JsonSchema),
  ]),
);

/** An object of arbitrary JSON, used where the shape belongs to a registry entry (tool settings, presets …). */
export const JsonObjectSchema = z.record(z.string(), JsonSchema);
