// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '@ueberblick/ui/testing';
import NewProjectForm from './NewProjectForm.svelte';

afterEach(cleanup);
const TEMPLATES = [
  { key: 'leer', version: '1.0.0', label: { de: 'Leeres Projekt', en: 'Empty project' } },
  { key: 'baumkataster', version: '1.0.0', label: { de: 'Baumkataster', en: 'Tree cadastre' } },
];
const base = {
  locale: 'de' as const,
  templates: TEMPLATES,
  values: { name: '', description: '', template: 'leer@1' },
  problems: {},
  onsubmit: () => undefined,
};

describe('Projekt erstellen (v3 projects/new/+page.svelte, plus the template select of Q10)', () => {
  it('title, subtitle, name, description, template, submit and cancel', () => {
    render(NewProjectForm, base);
    expect(screen.getByRole('heading', { name: 'Neues Projekt erstellen' })).toBeTruthy();
    expect(screen.getByLabelText('Projektname')).toBeTruthy();
    expect(screen.getByLabelText('Beschreibung')).toBeTruthy();
    expect(screen.getByLabelText('Vorlage')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Projekt erstellen' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Abbrechen' }).getAttribute('href')).toBe('/admin/projects');
  });

  it('the template select lists "Leeres Projekt" first and posts key@major', () => {
    render(NewProjectForm, base);
    const select = screen.getByLabelText('Vorlage') as HTMLSelectElement;
    const options = [...select.options].map((o) => [o.textContent?.trim(), o.value]);
    expect(options).toEqual([
      ['Leeres Projekt', 'leer@1'],
      ['Baumkataster', 'baumkataster@1'],
    ]);
    expect(select.value).toBe('leer@1');
    expect(select.getAttribute('name')).toBe('template');
  });

  it('shows the field problems, and keeps what was typed', () => {
    render(NewProjectForm, {
      ...base,
      values: { name: '', description: 'bleibt', template: 'baumkataster@1' },
      problems: { name: { key: 'project_new_name_required' as const } },
    });
    expect(screen.getByText('Der Name ist erforderlich')).toBeTruthy();
    expect(screen.getByLabelText('Projektname').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe('bleibt');
    expect((screen.getByLabelText('Vorlage') as HTMLSelectElement).value).toBe('baumkataster@1');
  });

  it('submitting reports once, without a native page post', async () => {
    const onsubmit = vi.fn();
    render(NewProjectForm, { ...base, onsubmit });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Projekt erstellen' }));
    expect(onsubmit).toHaveBeenCalledTimes(1);
  });

  it('English labels follow the language', () => {
    render(NewProjectForm, { ...base, locale: 'en' });
    expect(screen.getByLabelText('Template')).toBeTruthy();
    expect(
      [...(screen.getByLabelText('Template') as HTMLSelectElement).options][0]?.textContent?.trim(),
    ).toBe('Empty project');
  });
});
