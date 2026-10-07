import { describe, expect, it } from 'vitest';
import { actorName as resolve, actorNamesOf } from './actor-names';

const labels = { system: 'System', importBy: (a: string) => `Import (${a})` };
const actorName = (n: Record<string, string>, id: string): string => resolve(n, id, labels);
const names = actorNamesOf({
  participants: [
    { id: 'p1', name: 'Anna' },
    { id: 'p2', name: null },
  ],
  admins: [{ id: 'a1', email: 'chef@example.org' }],
});

describe('actor names', () => {
  it('a participant shows by name', () => expect(actorName(names, 'p1')).toBe('Anna'));
  it('an admin shows by e-mail', () => expect(actorName(names, 'a1')).toBe('chef@example.org'));
  it('an import shows with the admin who ran it', () =>
    expect(actorName(names, 'import:a1')).toBe('Import (chef@example.org)'));
  it('the system actor (rules, timers) shows as System', () =>
    expect(actorName(names, 'system')).toBe('System'));
  it('an unknown id and a participant without a name show as they are', () => {
    expect(actorName(names, 'zz')).toBe('zz');
    expect(actorName(names, 'p2')).toBe('p2');
    expect(actorName(names, 'import:gone')).toBe('import:gone');
  });
});
