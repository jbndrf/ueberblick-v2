import axe from 'axe-core';

/** Runs axe on a rendered element and returns violation ids. jsdom has no layout, so colour contrast
 * is proven from the tokens instead (tokens.spec.ts). */
export async function axeViolations(el: Element): Promise<string[]> {
  const result = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}
