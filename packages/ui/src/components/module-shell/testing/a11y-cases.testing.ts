// The axe cases of the module shell, for the coverage guard in `components.a11y.spec.ts`. Test-only.
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import ModuleShell from '../ModuleShell.svelte';

type Case = readonly [state: string, run: () => Promise<Element>];
const toggleLabel = 'Größe ändern';
const body = createRawSnippet(() => ({ render: () => '<p>Body</p>' }));

export const MODULE_SHELL_A11Y_CASES: Record<string, readonly Case[]> = {
  'components/module-shell/ModuleShell.svelte': [
    [
      'open with body',
      async () =>
        render(ModuleShell, {
          open: true,
          title: 'Baum',
          subtitle: 'Alte Eiche',
          badge: 'Prüfung',
          toggleLabel,
          children: body,
        }).baseElement,
    ],
    ['loading', async () => render(ModuleShell, { open: true, loading: true, toggleLabel }).baseElement],
    [
      'error',
      async () => render(ModuleShell, { open: true, error: 'Nicht gefunden', toggleLabel }).baseElement,
    ],
    ['empty', async () => render(ModuleShell, { open: true, toggleLabel }).baseElement],
  ],
};
