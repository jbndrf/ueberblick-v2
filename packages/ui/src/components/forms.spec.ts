// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import TextField from './TextField.svelte';
import ErrorSummary from './ErrorSummary.svelte';
import { axeViolations } from '../testing/axe';
import { TARGET_SIZE } from '../tokens';

describe('TextField', () => {
  it('associates the label with the input and accepts typing', async () => {
    render(TextField, { id: 'name', label: 'Tree species' });
    const input = screen.getByLabelText('Tree species') as HTMLInputElement;
    await userEvent.setup().type(input, 'Oak');
    expect(input.value).toBe('Oak');
  });

  it('error slot: sets aria-invalid and links the message with aria-describedby', () => {
    render(TextField, { id: 'h', label: 'Height', error: 'Enter a number', hint: 'In metres' });
    const input = screen.getByLabelText('Height');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts.join(' ')).toContain('Enter a number');
    expect(texts.join(' ')).toContain('In metres');
  });

  it('without an error there is no aria-invalid and no empty error element', () => {
    render(TextField, { id: 'h', label: 'Height' });
    const input = screen.getByLabelText('Height');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });

  it('marks required fields with text, not colour alone', () => {
    render(TextField, { id: 'h', label: 'Height', required: true });
    expect(screen.getByLabelText(/Height/).hasAttribute('required')).toBe(true);
    expect(screen.getByText(/required/i)).toBeTruthy();
  });

  it('the input is a primary touch target (56 px)', () => {
    render(TextField, { id: 'h', label: 'Height' });
    expect(parseFloat(getComputedStyle(screen.getByLabelText('Height')).minHeight)).toBeGreaterThanOrEqual(
      TARGET_SIZE.primary,
    );
  });

  it('has no axe violations, with and without error', async () => {
    const a = render(TextField, { id: 'a', label: 'A' });
    expect(await axeViolations(a.container)).toEqual([]);
    const b = render(TextField, { id: 'b', label: 'B', error: 'Bad', hint: 'Hint', required: true });
    expect(await axeViolations(b.container)).toEqual([]);
  });
});

describe('ErrorSummary', () => {
  const errors = [
    { fieldId: 'f1', message: 'Height is required' },
    { fieldId: 'f2', message: 'Species is unknown' },
  ];

  function mountFields() {
    for (const id of ['f1', 'f2']) {
      const i = document.createElement('input');
      i.id = id;
      document.body.appendChild(i);
    }
  }

  it('moves focus to the summary when errors appear', () => {
    render(ErrorSummary, { errors });
    const summary = screen.getByRole('alert');
    expect(document.activeElement).toBe(summary);
    expect(screen.getByText('Please fix these problems')).toBeTruthy();
  });

  it('each message is a link that focuses its field', async () => {
    mountFields();
    render(ErrorSummary, { errors });
    const link = screen.getByRole('link', { name: 'Species is unknown' });
    await userEvent.setup().click(link);
    expect(document.activeElement).toBe(document.getElementById('f2'));
  });

  it('links are at least 44 px high', () => {
    render(ErrorSummary, { errors });
    for (const link of screen.getAllByRole('link')) {
      expect(parseFloat(getComputedStyle(link).minHeight)).toBeGreaterThanOrEqual(TARGET_SIZE.other);
    }
  });

  it('links work from the keyboard', async () => {
    mountFields();
    render(ErrorSummary, { errors });
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Height is required' }));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(document.getElementById('f1'));
  });

  it('renders nothing without errors and refocuses when errors reappear', async () => {
    const { rerender, container } = render(ErrorSummary, { errors: [] });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await rerender({ errors });
    expect(document.activeElement).toBe(screen.getByRole('alert'));
  });

  it('has no axe violations', async () => {
    const { container } = render(ErrorSummary, { errors });
    expect(await axeViolations(container)).toEqual([]);
  });
});
