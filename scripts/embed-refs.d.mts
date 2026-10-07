/**
 * `value` with every `{ $ref: string }` object replaced by the JSON of `<root>/fixtures/golden/<ref>`; a `$comment`
 * key of the resolved file is dropped. Delegates to core's `embedRefs`
 * (packages/core/src/schema/compile/embed-refs.ts), loaded through Node 22's type stripping.
 */
export function embedRefs(value: unknown, root: string): unknown;
