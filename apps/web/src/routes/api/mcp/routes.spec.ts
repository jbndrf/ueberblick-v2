import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authorizeAdmin } from '../../../lib/server/authz';

// The route files use the `$lib` alias, which the unit-test config does not resolve, so the wiring is
// asserted on the route sources: each one imports `authorizeAdmin` from `$lib/server/authz` and is the
// only thing it hands to `deps(...)`, which `createMcpHandlers` gets.
const route = (rel: string): string => readFileSync(resolve(import.meta.dirname, rel), 'utf8');

describe('the MCP routes use the builder admin check (A-008)', () => {
  it.each(['[project]/+server.ts', '[project]/confirm/+server.ts'])(
    '%s passes authorizeAdmin to the handlers',
    (file) => {
      const src = route(file);
      expect(src).toMatch(/import \{ authorizeAdmin \} from '\$lib\/server\/authz';/);
      expect(src).toMatch(/createMcpHandlers\(deps\(authorizeAdmin\)\)/);
    },
  );

  it('`deps` gives its authorize argument to the handlers unchanged', () => {
    expect(route('source.ts')).toMatch(/authorize,\n\s+ensure,/);
  });

  it('authorizeAdmin refuses an anonymous caller with 401', () => {
    const r = authorizeAdmin(null, 'muster');
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(401);
  });
});
