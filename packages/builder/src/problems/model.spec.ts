import { describe, expect, it } from 'vitest';
import { openProject } from '../doc';
import { docWithProblems, goldenProjects } from '../testing/golden';
import { problemItems, problemsReport } from './model';

describe('problem items', () => {
  it('are the document problems, same order, each with its location and path', () => {
    const doc = docWithProblems();
    const items = problemItems(doc, 'en');
    expect(items.map((i) => i.path)).toEqual(doc.problems().map((p) => p.path));
    expect(items[0]).toMatchObject({
      path: 'types.baum.properties.art.to',
      code: 'dangling_reference',
      location: { type: 'baum' },
      message: '"gibt_es_nicht" is not a known feature type.',
    });
    expect(items[0]?.hint).toContain('baumart');
  });

  it('ids are unique so a list can be keyed', () => {
    const items = problemItems(docWithProblems(), 'en');
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('a clean project has no items', () => {
    for (const p of goldenProjects.filter((q) => !q.name.includes('violation'))) {
      const doc = openProject(p.templateSrc, p.overlaySrc);
      expect(problemItems(doc, 'de')).toHaveLength(doc.problems().length);
    }
  });

  it('the report is plain JSON (H4: the API serves the same list the panel shows)', () => {
    const doc = docWithProblems();
    const report = problemsReport(doc, 'en');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report.count).toBe(report.problems.length);
    expect(report.revision).toBe(doc.revision);
  });
});
