/** Tool settings that have a schema (WP-577): `tools.search.sources`, checked against the file's own types. */
import type { TemplateFile } from '../file';
import { SEARCHABLE_PROPERTY_TYPES } from '../../registry';
import { BUILTIN_TOOL_SCHEMAS, checkToolLayer, type ToolSchemas } from '../../registry/tools';
import { kp } from './kp';
import type { Sink } from './problems';

const schemaOf = (tool: string): ToolSchemas | undefined =>
  Object.hasOwn(BUILTIN_TOOL_SCHEMAS, tool)
    ? (BUILTIN_TOOL_SCHEMAS as Readonly<Record<string, ToolSchemas>>)[tool]
    : undefined;

/** Checks a layer of settings against the tool schema; a layer of a tool without a known schema stays unchecked. */
function checkLayer(
  tool: string,
  layer: Readonly<Record<string, unknown>>,
  at: readonly (string | number)[],
  sink: Sink,
): void {
  const schemas = schemaOf(tool);
  if (schemas === undefined) return;
  for (const issue of checkToolLayer(schemas, layer))
    sink.error(
      kp(...at, ...issue.path),
      'tool_setting_invalid',
      `${issue.path.join('.')} ${issue.message}`,
      'set the option as the tool schema describes (docs/05-config-format.md, Tools)',
      { tool, setting: issue.path.join('.'), detail: issue.message },
    );
}

/** Project and role settings of every tool with a known schema (WP-613), then the search sources. */
export function checkToolSettings(file: TemplateFile, sink: Sink): void {
  for (const [tool, layer] of Object.entries(file.tools ?? {}))
    checkLayer(tool, layer, ['tools', tool], sink);
  for (const [role, def] of Object.entries(file.roles ?? {}))
    for (const [tool, entry] of Object.entries(def.app?.tools ?? {}))
      if (entry.settings)
        checkLayer(tool, entry.settings, ['roles', role, 'app', 'tools', tool, 'settings'], sink);
  checkSearchSources(file, sink);
}

/** Every `tools.search.sources` entry is `<type>.<property>` of a searchable property type. */
function checkSearchSources(file: TemplateFile, sink: Sink): void {
  const sources = file.tools?.search?.sources;
  if (sources === undefined) return;
  const hint = `use \`<type>.<property>\` of a property of type ${SEARCHABLE_PROPERTY_TYPES.keys.join(', ')}`;
  if (!Array.isArray(sources)) {
    sink.error(
      kp('tools', 'search', 'sources'),
      'tool_source_invalid',
      'sources must be a list of `type.property` entries',
      hint,
      { types: SEARCHABLE_PROPERTY_TYPES.keys.join(', ') },
    );
    return;
  }
  sources.forEach((entry, i) => {
    const at = kp('tools', 'search', 'sources', i);
    const parts = typeof entry === 'string' ? entry.split('.') : [];
    const [tk, pk] = parts;
    if (parts.length !== 2 || !tk || !pk) {
      sink.error(at, 'tool_source_invalid', `'${String(entry)}' is not a \`type.property\` entry`, hint, {
        variant: 'entry',
        entry: String(entry),
        types: SEARCHABLE_PROPERTY_TYPES.keys.join(', '),
      });
      return;
    }
    const type = file.types?.[tk];
    if (type === undefined) {
      sink.error(at, 'tool_source_invalid', `'${tk}' is not a feature type`, hint, {
        variant: 'not_type',
        type: tk,
        types: SEARCHABLE_PROPERTY_TYPES.keys.join(', '),
      });
      return;
    }
    const property = type.properties[pk];
    if (property === undefined) {
      sink.error(at, 'tool_source_invalid', `'${tk}' has no property '${pk}'`, hint, {
        variant: 'no_property',
        type: tk,
        property: pk,
        types: SEARCHABLE_PROPERTY_TYPES.keys.join(', '),
      });
    } else if (!SEARCHABLE_PROPERTY_TYPES.has(property.type)) {
      sink.error(
        at,
        'tool_source_invalid',
        `'${tk}.${pk}' is a ${property.type} and cannot be searched`,
        hint,
        {
          variant: 'not_searchable',
          type: tk,
          property: pk,
          kind: property.type,
          types: SEARCHABLE_PROPERTY_TYPES.keys.join(', '),
        },
      );
    }
  });
}
