import { describe, expect, it } from 'vitest';
import { goldenDoc, templates } from '../../lenses/process/fixtures';
import { childLinks, parentLinks, subprocessLinks } from './subprocess';

const links = (key: string, version: string) => subprocessLinks(goldenDoc(key, version).effective(), 'de');

describe('sub-process links over the golden projects', () => {
  it('baumkataster: Maßnahme anlegen on a tree starts the measure process', () => {
    const all = links('baumkataster', '2.0.0');
    expect(all).toEqual([
      {
        task: 'massnahme_anlegen',
        parent: 'baum',
        parentLabel: 'Baum',
        child: 'massnahme',
        childLabel: 'Maßnahme',
        relation: 'baum',
      },
    ]);
    expect(childLinks(all, 'baum').map((l) => l.task)).toEqual(['massnahme_anlegen']);
    expect(parentLinks(all, 'massnahme').map((l) => l.parentLabel)).toEqual(['Baum']);
  });

  it('veranstaltung: Auflage erteilen links the event to its condition', () => {
    const all = links('veranstaltung', '1.0.0');
    expect(all.map((l) => [l.task, l.parent, l.child, l.relation])).toEqual([
      ['auflage_erteilen', 'veranstaltung', 'auflage', 'veranstaltung'],
    ]);
  });

  it('finds no false links: map, no-subject and same-type creating tasks, and creates without a relation', () => {
    expect(links('maengelmelder', '1.0.0')).toEqual([]);
    for (const [key, version] of templates) {
      for (const l of links(key, version)) expect(l.parent).not.toBe(l.child);
    }
    expect(links('baumkataster', '2.0.0').map((l) => l.task)).not.toContain('erfassen');
    expect(links('baumkataster', '2.0.0').map((l) => l.task)).not.toContain('flaeche_anlegen');
  });

  it('a type that is not a child has no parents; a child lists each parent once', () => {
    const all = links('baumkataster', '2.0.0');
    expect(parentLinks(all, 'baum')).toEqual([]);
    expect(parentLinks([...all, ...all], 'massnahme')).toHaveLength(1);
  });
});
