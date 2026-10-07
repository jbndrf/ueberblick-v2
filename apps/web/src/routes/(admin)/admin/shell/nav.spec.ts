import { describe, expect, it } from 'vitest';
import { GROUPS, PROJECTS_ITEM, isActive, isTypeActive, itemForPath, projectIdOf, projectItems } from './nav';
import { adminMessage } from './messages';

describe('the sidebar item list (v3 order, data-driven)', () => {
  it('Projekte links to /admin/projects', () => {
    expect(PROJECTS_ITEM.href).toBe('/admin/projects');
    expect(adminMessage('de', PROJECTS_ITEM.label)).toBe('Projekte');
  });

  it('a project shows settings, participants, roles, relations and Versionen at v3 URLs, in v3 order', () => {
    const items = projectItems('p1');
    expect(items.map((i) => i.href)).toEqual([
      '/admin/projects/p1/settings',
      '/admin/projects/p1/participants',
      '/admin/projects/p1/roles',
      '/admin/projects/p1/relations',
      '/admin/projects/p1/versions',
    ]);
    expect(items.map((i) => adminMessage('de', i.label))).toEqual([
      'Projekteinstellungen',
      'Teilnehmende',
      'Rollen',
      'Beziehungen',
      'Versionen',
    ]);
    expect(items.map((i) => adminMessage('en', i.label))).toContain('Versions');
  });

  it('the Objektarten and Tabellen groups exist, with an empty text', () => {
    expect(GROUPS.map((g) => adminMessage('de', g.label))).toEqual(['Objektarten', 'Tabellen']);
    expect(GROUPS.map((g) => adminMessage('de', g.empty))).toEqual([
      'Noch keine Objektarten',
      'Noch keine Tabellen',
    ]);
  });
});

describe('active state and project id', () => {
  it('projectIdOf reads the id from /admin/projects/<id>/…', () => {
    expect(projectIdOf('/admin/projects/p1/roles')).toBe('p1');
    expect(projectIdOf('/admin/projects/p1')).toBe('p1');
    expect(projectIdOf('/admin/projects')).toBeNull();
    expect(projectIdOf('/admin/login')).toBeNull();
  });
  it('an item is active on its own page only', () => {
    expect(isActive('/admin/projects', '/admin/projects')).toBe(true);
    expect(isActive('/admin/projects/p1/roles', '/admin/projects')).toBe(false);
    expect(isActive('/admin/projects/p1/roles', '/admin/projects/p1/roles')).toBe(true);
  });
  it('a type entry is active on every page under its data page or builder, a table also under its table page', () => {
    expect(isTypeActive('/admin/projects/p1/types/baum/builder', 'p1', 'baum')).toBe(true);
    expect(isTypeActive('/admin/projects/p1/tables/baumart', 'p1', 'baumart')).toBe(true);
    expect(isTypeActive('/admin/projects/p1/tables', 'p1', 'baumart')).toBe(false);
    expect(isTypeActive('/admin/projects/p1/tables/baumart_2', 'p1', 'baumart')).toBe(false);
  });
  it('itemForPath names the page a placeholder stands in for', () => {
    expect(itemForPath('/admin/projects/p1/participants')?.key).toBe('participants');
    expect(itemForPath('/admin/projects')?.key).toBe('projects');
    expect(itemForPath('/admin/projects/p1/unknown')).toBeNull();
  });
});
