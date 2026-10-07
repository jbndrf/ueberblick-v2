// WP-671: the demo project (the golden musterstadt-baeume overlay on baumkataster, every version the demo or an upgrade
// can sit on) offers the ported tools and declares the child list the feature sheet's relation path follows.
// v3 had both as opt-in switches, off at first (`participant-state/enabled-features.svelte.ts:30-35`); the relation
// example of v3 is "inspection on a pump" (`docs/dev/workflow-relations.md` §1), here a Maßnahme on a Baum.
import { describe, expect, it } from 'vitest';
import { OverlayFileSchema, TemplateFileSchema } from '../../../../../../packages/core/src/schema/file';
import type { TemplateFile } from '@ueberblick/core/model';
import { merge } from '../../../../../../packages/core/src/template';
import { goldenYaml } from '../../../../../../packages/core/src/testing';
import type { FeatureId } from '@ueberblick/core/model';
import { createRelationNav, hierarchyGroups } from '../../participant/feature/relations/nav';
import { deps, world, type Node } from '../../participant/feature/relations/fixtures';
import { switchableTools, toolEntries } from '../../participant/tools/entries';

const VERSIONS = ['1.0.0', '1.1.0', '2.0.0'];
const overlay = OverlayFileSchema.parse(goldenYaml('projects/musterstadt-baeume.yaml'));

function demoFile(version: string): TemplateFile {
  const template = TemplateFileSchema.parse(goldenYaml(`templates/baumkataster/${version}.yaml`));
  const m = merge(template, overlay);
  expect(m.issues).toEqual([]);
  return TemplateFileSchema.parse(m.file) as TemplateFile;
}

describe.each(VERSIONS)('demo on baumkataster %s', (version) => {
  const file = demoFile(version);

  it.each(['kontrolle', 'verwaltung'])(
    '%s (a map role) is offered Ansichten and Cluster, off until switched on',
    (role) => {
      const rows = switchableTools(toolEntries(file, role, {}));
      for (const key of ['views', 'cluster']) {
        const row = rows.find((r) => r.key === key);
        expect(row?.availability, key).toBe('offered');
        expect(row?.on, key).toBe(false);
      }
      const on = switchableTools(toolEntries(file, role, { views: true, cluster: true }));
      expect(on.filter((r) => r.key === 'views' || r.key === 'cluster').every((r) => r.on)).toBe(true);
    },
  );

  it('bauhof (no map) has neither', () => {
    const keys = toolEntries(file, 'bauhof', {}).map((e) => e.key);
    expect(keys).not.toContain('views');
    expect(keys).not.toContain('cluster');
  });

  it('declares the Maßnahmen of a Baum as its child list, and no lookup or derived edge as one', () => {
    const groups = hierarchyGroups(file);
    expect([...groups]).toEqual(['massnahme.baum']);
    expect(groups.has('baum.art')).toBe(false);
  });
});

describe('the feature sheet on the demo file', () => {
  const WORLD: Record<string, Node> = {
    b1: { type: 'baum', label: 'Eiche', stage: 'erfasst' },
    a1: { type: 'baumart', label: 'Linde' },
    m1: { type: 'massnahme', label: 'Schnitt', stage: 'offen', parents: [['baum', 'b1']] },
  };
  const nav = createRelationNav({ ...deps(world(WORLD).source), file: demoFile('1.1.0') });

  it("shows the path from a Maßnahme to its Baum and the Baum's Maßnahmen list", () => {
    expect(nav.chains('m1' as FeatureId)).toEqual([[{ parent: 'b1', group: 'massnahme.baum' }]]);
    expect(nav.children('b1' as FeatureId, 'massnahme.baum')).toEqual(['m1']);
    expect(nav.groupName('b1' as FeatureId, 'massnahme.baum')).toBe('Maßnahmen');
  });

  it('shows neither for a lookup (Baum.art)', () => {
    expect(nav.chains('b1' as FeatureId)).toEqual([]);
    expect(nav.groups('a1' as FeatureId)).toEqual([]);
  });
});
