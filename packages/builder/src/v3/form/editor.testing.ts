// jsdom helper of the form editor specs (WP-393): the builder shell on the task `kontrolle` with its form open.
import { vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import '../task/shims.testing';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { registerFieldPane } from '../field/register';
import BuilderShell from '../shell/BuilderShell.svelte';
import { createBuilderRegistry } from '../shell/registry';
import { registerTaskPane } from '../task';
import { formOf } from './model';
import { registerFormEditor } from './register';

export const TASK = 'kontrolle';
export const TYPE = 'baum';

export const clean = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
export const reloaded = (doc: Doc): Doc => openProject(musterstadt.templateSrc, doc.save().overlaySrc);

export function stubBrowser(): void {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
}

/** The form editor of `kontrolle`; the doc the editor changed is `last()`. */
export async function openEditor(doc: Doc = clean()) {
  const registry = createBuilderRegistry();
  registerTaskPane(registry);
  registerFieldPane(registry);
  registerFormEditor(registry);
  const onchange = vi.fn();
  render(BuilderShell, { doc, type: TYPE, locale: 'de', registry, onchange });
  await userEvent.click(document.querySelector(`[data-path="tasks.${TASK}"]`) as HTMLElement);
  await userEvent.click(screen.getByRole('tab', { name: 'Formular' }));
  await userEvent.click(screen.getByTestId('step-0-edit'));
  const last = (): Doc => (onchange.mock.calls.at(-1)?.[0] as Doc) ?? doc;
  return {
    last,
    entry: (key: string) => formOf(last().effective(), TASK)[key],
    prop: (key: string) => last().effective().types?.[TYPE]?.properties[key],
    select: (key: string) => userEvent.click(document.querySelector(`[data-key="${key}"]`) as HTMLElement),
  };
}
