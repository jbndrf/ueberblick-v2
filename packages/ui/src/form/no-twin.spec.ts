// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R1: relevance, required, readonly, constraint and calculate are evaluated only by core.form.
describe('the form renderer holds no copy of form semantics', () => {
  const dirs = [__dirname, join(__dirname, '..', 'task-sheet')];
  const sources = dirs.flatMap((d) =>
    readdirSync(d)
      .filter((f) => /\.(ts|svelte)$/.test(f) && !/\.spec\.ts$|^testing/.test(f))
      .map((f) => [f, readFileSync(join(d, f), 'utf8')] as const),
  );

  it('has no evaluator port and no expression evaluation', () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/FormEvaluator|evaluator\b/);
      expect(text, file).not.toMatch(/\.(relevant|constraint|calculate)\(/);
      expect(text, file).not.toMatch(/^import (?!type)[^\n]*@ueberblick\/core\/expr/m);
    }
  });

  it('only the session calls core.form', () => {
    const users = sources.filter(([, t]) => /formApi/.test(t)).map(([f]) => f);
    expect(users).toEqual(['session.ts']);
  });
});
