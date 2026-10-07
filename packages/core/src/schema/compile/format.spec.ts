// `expr/ast.ts` is a persisted format (A-005 item 2): changing it needs a COMPILED_FORMAT bump.
import { describe, expect, it } from 'vitest';
import { AST_HASH_BY_FORMAT, COMPILED_FORMAT } from './contract';
import { sha256Hex } from './hash';

const source = import.meta.glob('../../expr/ast.ts', { query: '?raw', import: 'default', eager: true });

/** The AST source without comments and whitespace, so only a change of shape moves the hash. */
function astHash(text: string): string {
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return sha256Hex(code);
}

describe('COMPILED_FORMAT pins expr/ast.ts', () => {
  const current = astHash(Object.values(source)[0] as string);

  it('records a hash for the current format', () => {
    expect(AST_HASH_BY_FORMAT[COMPILED_FORMAT]).toBeDefined();
  });

  it('the recorded hash equals the hash of ast.ts (changing ast.ts needs a format bump and a new hash)', () => {
    expect(
      AST_HASH_BY_FORMAT[COMPILED_FORMAT],
      `expr/ast.ts changed (hash ${current}). Bump COMPILED_FORMAT and record the hash under the new number in contract.ts.`,
    ).toBe(current);
  });

  it('ignores comments and whitespace', () => {
    expect(astHash('export type A = 1; // x\n/* y */\nexport   type B = 2;')).toBe(
      astHash('export type A = 1;\nexport type B = 2;'),
    );
  });
});
