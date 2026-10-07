import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { toolAvailabilityFor } from '@ueberblick/core';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { CLUSTER_TOOL, setToolStart } from './start-doc';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const ROLES = ['kontrolle', 'bauhof', 'verwaltung'] as const;

/** How a role's tool list may look: none, empty, the tool bare, `offered`, `active`, or only another tool. */
const listing = fc.constantFrom('none', 'empty', 'bare', 'offered', 'active', 'other');

function configure(declared: boolean, lists: readonly string[]): Doc {
  let doc = openProject(
    golden('templates/baumkataster/1.1.0.yaml'),
    golden('projects/musterstadt-baeume.yaml'),
  );
  const put = (path: string, value: unknown): void => {
    const r = doc.apply({ kind: 'set', path, value });
    if (r.refused) throw new Error(r.refused.message);
    doc = r.doc;
  };
  if (declared) put(`tools.${CLUSTER_TOOL}`, {});
  ROLES.forEach((role, i) => {
    const how = lists[i];
    const tools: Record<string, unknown> | undefined =
      how === 'empty'
        ? {}
        : how === 'bare'
          ? { [CLUSTER_TOOL]: {} }
          : how === 'offered' || how === 'active'
            ? { [CLUSTER_TOOL]: { availability: how } }
            : how === 'other'
              ? { photo: {} }
              : undefined;
    if (tools !== undefined) put(`roles.${role}.app`, { tools });
  });
  return doc;
}

describe('setToolStart reads availability through core (WP-407)', () => {
  it('property: after on every target role has the tool active; after off, offered if it had it, else unchanged', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(listing, { minLength: 3, maxLength: 3 }),
        fc.subarray([...ROLES], { minLength: 1 }),
        fc.boolean(),
        (declared, lists, targets, on) => {
          const doc = configure(declared, lists);
          const before = doc.effective();
          const r = setToolStart(doc, CLUSTER_TOOL, targets, on);
          if (!r.ok) throw new Error(JSON.stringify(r));
          const after = r.doc.effective();
          for (const role of ROLES) {
            const was = toolAvailabilityFor(before, [role], CLUSTER_TOOL);
            const now = toolAvailabilityFor(after, [role], CLUSTER_TOOL);
            if (!targets.includes(role)) expect(after.roles?.[role]).toEqual(before.roles?.[role]);
            else if (on) expect(now).toBe('active');
            else expect(now).toBe(was === undefined ? undefined : 'offered');
          }
        },
      ),
      { numRuns: 40 },
    );
  }, 30_000);
});
