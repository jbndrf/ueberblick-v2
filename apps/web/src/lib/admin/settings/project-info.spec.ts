import { describe, expect, it } from 'vitest';
import { projectInfoOf } from './project-info';

const SHA = 'f'.repeat(64);

describe('projectInfoOf (the bootstrap project.displayName and project.icon)', () => {
  it('falls back to the project name and no icon without branding', () => {
    expect(projectInfoOf('Musterstadt', undefined)).toEqual({ displayName: 'Musterstadt', icon: null });
    expect(projectInfoOf('Musterstadt', {})).toEqual({ displayName: 'Musterstadt', icon: null });
  });
  it('uses the branding name and icon', () => {
    expect(projectInfoOf('Musterstadt', { name: 'Stadt-App', icon: SHA })).toEqual({
      displayName: 'Stadt-App',
      icon: SHA,
    });
  });
  it('picks German, then any language, of a per-language name', () => {
    expect(projectInfoOf('M', { name: { en: 'City', de: 'Stadt' } }).displayName).toBe('Stadt');
    expect(projectInfoOf('M', { name: { en: 'City' } }).displayName).toBe('City');
  });
  it('a blank name falls back to the project name', () => {
    expect(projectInfoOf('M', { name: { de: '  ' } }).displayName).toBe('M');
  });
});
