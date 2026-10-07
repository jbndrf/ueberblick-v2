// Turns a snapshot ref into the locator that goes into the action log: role + accessible name first,
// data-testid second, label (only for controls without a role, such as a password field) third.
// Never CSS or XPath. Every candidate is checked against the page before it is logged, so the log only
// holds locators that really find the element.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** The element behind a ref. The data-ui-ref stamp is internal and is never logged. */
export const byRef = (page, ref) => page.locator(`[data-ui-ref="${ref}"]`);

async function indexIn(candidates, ref) {
  const n = await candidates.count();
  for (let i = 0; i < n; i++)
    if ((await candidates.nth(i).getAttribute('data-ui-ref')) === ref) return { i, n };
  return undefined;
}

/** @returns {Promise<{ locator: object | null, warning?: string }>} */
export async function logLocator(page, ref, node) {
  if (node === undefined) return { locator: null, warning: `unknown ref ${ref}` };
  if (node.aria && node.name) {
    const hit = await indexIn(page.getByRole(node.role, { name: node.name, exact: true }), ref);
    if (hit) return { locator: { role: node.role, name: node.name, ...(hit.n > 1 ? { nth: hit.i } : {}) } };
  }
  if (node.testid) {
    const hit = await indexIn(page.getByTestId(node.testid), ref);
    if (hit) return { locator: { testid: node.testid, ...(hit.n > 1 ? { nth: hit.i } : {}) } };
  }
  if (!node.aria && node.name) {
    const hit = await indexIn(page.getByLabel(node.name, { exact: true }), ref);
    if (hit) return { locator: { label: node.name, ...(hit.n > 1 ? { nth: hit.i } : {}) } };
  }
  return {
    locator: null,
    warning: `${ref} (${node.role}${node.name ? ` "${node.name}"` : ''}) has no role+name and no data-testid: add one`,
  };
}

/** One JSONL line per action: {at, cmd, ref, locator, args, url}. */
export function appendAction(runDir, entry) {
  appendFileSync(join(runDir, 'actions.jsonl'), `${JSON.stringify(entry)}\n`);
}
