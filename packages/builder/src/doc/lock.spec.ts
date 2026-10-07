import { describe, expect, it } from 'vitest';
import { lockOf, openProject } from './index';
import { musterstadt } from '../testing/golden';

const doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const LOCK = 'types.baum.properties.stage.options';

describe('lockOf, the one template-lock matcher', () => {
  it('finds a lock the path is under, equal to or above', () => {
    expect(doc.template.lock).toContain(LOCK);
    expect(lockOf(doc, LOCK)).toBe(LOCK);
    expect(lockOf(doc, `${LOCK}.erfasst.label`)).toBe(LOCK);
    expect(lockOf(doc, 'types.baum.properties.stage')).toBe(LOCK);
  });

  it('leaves a sibling or unrelated path free', () => {
    expect(lockOf(doc, 'types.baum.properties.befund')).toBeUndefined();
    expect(lockOf(doc, 'types.baum.properties.stage.label')).toBeUndefined();
  });
});
