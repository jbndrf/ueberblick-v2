/**
 * Walking the project file's JSON Schema (generated from the Zod schema, F7) along a key path.
 * Headless: no DOM. The completion source and the diagnostics share it.
 */
import { projectFileJsonSchema } from '@ueberblick/core';

/** The parts of a JSON Schema node the lens reads. */
export interface SchemaNode {
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly additionalProperties?: SchemaNode | boolean;
  readonly items?: SchemaNode;
  readonly anyOf?: readonly SchemaNode[];
  readonly enum?: readonly unknown[];
  readonly $ref?: string;
}

interface Root extends SchemaNode {
  readonly $defs?: Readonly<Record<string, SchemaNode>>;
}

let cached: Root | undefined;
const root = (): Root => (cached ??= projectFileJsonSchema() as Root);

/** A path segment that stands for "an element of the list here". */
export const ITEM = '#item';

function resolve(node: SchemaNode): SchemaNode {
  if (node.$ref === undefined) return node;
  const name = node.$ref.replace('#/$defs/', '');
  return root().$defs?.[name] ?? {};
}

/** A node with its `anyOf` branches flattened (nested branches too). */
function branches(node: SchemaNode): SchemaNode[] {
  const n = resolve(node);
  return n.anyOf === undefined ? [n] : n.anyOf.flatMap(branches);
}

/** The top-level schema of the overlay file or of the template file. */
export function fileSchema(kind: 'overlay' | 'template'): SchemaNode {
  const want = kind === 'overlay' ? 'extends' : 'template';
  const hit = branches(root()).find((b) => b.properties?.[want] !== undefined);
  return hit ?? {};
}

function step(nodes: readonly SchemaNode[], seg: string): SchemaNode[] {
  const out: SchemaNode[] = [];
  for (const node of nodes.flatMap(branches)) {
    if (seg === ITEM) {
      if (node.items !== undefined) out.push(node.items);
      continue;
    }
    const prop = node.properties?.[seg];
    if (prop !== undefined) out.push(prop);
    else if (typeof node.additionalProperties === 'object') out.push(node.additionalProperties);
  }
  return out;
}

/** The schema nodes that describe the value at `segs` below `start` (none when the path leaves the schema). */
export function schemaAt(start: SchemaNode, segs: readonly string[]): SchemaNode[] {
  let nodes: SchemaNode[] = [start];
  for (const seg of segs) {
    nodes = step(nodes, seg);
    if (nodes.length === 0) return [];
  }
  return nodes.flatMap(branches);
}

export interface KeyOption {
  readonly key: string;
  readonly description?: string;
}

/** The property keys the object schemas offer. A dictionary schema (`additionalProperties`) offers none. */
export function childKeys(nodes: readonly SchemaNode[]): KeyOption[] {
  const seen = new Map<string, KeyOption>();
  for (const node of nodes.flatMap(branches)) {
    for (const [key, sub] of Object.entries(node.properties ?? {})) {
      if (seen.has(key)) continue;
      const description = resolve(sub).description ?? sub.description;
      seen.set(key, description === undefined ? { key } : { key, description });
    }
  }
  return [...seen.values()];
}

/** Values the schemas allow as a scalar (enums and booleans). */
export function valueOptions(nodes: readonly SchemaNode[]): string[] {
  const out = new Set<string>();
  for (const node of nodes.flatMap(branches)) {
    if (node.type === 'boolean') {
      out.add('true');
      out.add('false');
    }
    for (const v of node.enum ?? []) if (typeof v === 'string') out.add(v);
  }
  return [...out];
}
