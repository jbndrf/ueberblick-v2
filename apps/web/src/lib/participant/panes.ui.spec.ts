// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import NoticeBar from './NoticeBar.svelte';
import ProblemBar from './ProblemBar.svelte';

describe('NoticeBar', () => {
  it('says the hold out loud as an alert; an expired sign-in offers to sign in again', () => {
    render(NoticeBar, {
      notice: {
        kind: 'auth_expired',
        text: 'The sign-in has expired. 2 unsent runs stay on this device.',
        signIn: true,
      },
      locale: 'en',
    });
    expect(screen.getByRole('alert').textContent).toContain('2 unsent runs stay on this device');
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/login');
  });

  it('an incompatible server has no sign-in link: nothing the person can do here but update', () => {
    render(NoticeBar, {
      notice: {
        kind: 'incompatible_protocol',
        text: 'This app version does not fit the server (protocol 2).',
        signIn: false,
      },
      locale: 'en',
    });
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('ProblemBar', () => {
  it('names each problem with its code and what it is about', () => {
    render(ProblemBar, {
      problems: [
        { code: 'style_unresolved', subject: 'baeume', detail: 'styles/baum.json' },
        { code: 'tool_setting_invalid', subject: 'search', detail: 'unknown source' },
      ],
      locale: 'en',
    });
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('baeume');
    expect(items[0]).toContain('style_unresolved');
    expect(items[1]).toContain('search');
    expect(items[1]).toContain('tool_setting_invalid');
  });
});

describe('ProblemBar live region', () => {
  const style = { code: 'style_unresolved', subject: 'baeume', detail: 'styles/baum.json' } as const;
  const tool = { code: 'tool_setting_invalid', subject: 'search', detail: 'unknown source' } as const;

  it('the status role sits on a wrapper, so the list inside keeps its list semantics (axe listitem)', () => {
    render(ProblemBar, { problems: [style], locale: 'en' });
    const region = screen.getByRole('status');
    expect(region.tagName).not.toBe('UL');
    const list = within(region).getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('announces each notice once: only additions are read, and a notice already shown is not rebuilt', async () => {
    const { rerender } = render(ProblemBar, { problems: [style], locale: 'en' });
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-atomic')).toBe('false'); // status defaults to atomic: it would re-read everything
    expect(region.getAttribute('aria-relevant')).toBe('additions');
    const first = screen.getAllByRole('listitem')[0];
    await rerender({ problems: [style, tool], locale: 'en' });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[0]).toBe(first); // the same node: not announced again
  });

  it('the region stays in the page with no problem, so a later notice is announced', async () => {
    const { rerender } = render(ProblemBar, { problems: [], locale: 'en' });
    const region = screen.getByRole('status');
    expect(within(region).queryByRole('list')).toBeNull();
    await rerender({ problems: [style], locale: 'en' });
    expect(screen.getByRole('status')).toBe(region);
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
  });
});
