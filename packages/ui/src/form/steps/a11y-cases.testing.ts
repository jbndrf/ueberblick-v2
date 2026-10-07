// The axe cases of the multi-step flow, for the coverage guard in `components.a11y.spec.ts`. Test-only.
import { tick } from 'svelte';
import { render } from '@testing-library/svelte';
import '../../components/ui/jsdom-shims.testing';
import { fakeIds, fakeSubmitter } from '../../task-sheet/testing/ports';
import LocationStep from './LocationStep.svelte';
import StepFlow from './StepFlow.svelte';
import { labels, TASK, viewsOf } from './steps.testing';

type Case = readonly [state: string, run: () => Promise<Element>];

const locationStep = (canPick: boolean) => async () =>
  render(LocationStep, {
    label: 'Lage',
    chosen: false,
    picking: false,
    canPick,
    last: !canPick,
    labels,
    onpick: () => undefined,
    onback: () => undefined,
    onnext: () => undefined,
  }).container;

export const STEPS_A11Y_CASES: Record<string, readonly Case[]> = {
  'form/steps/StepFlow.svelte': [
    [
      'form step of two',
      async () => {
        const steps = viewsOf({
          form: { befund: {} },
          steps: [{ kind: 'form' }, { kind: 'location', property: 'lage' }],
        });
        const v = render(StepFlow, {
          taskKey: TASK,
          steps,
          labels,
          ids: fakeIds(),
          submitter: fakeSubmitter(),
          online: true,
          onclose: () => undefined,
        });
        await tick();
        return v.container;
      },
    ],
  ],
  'form/steps/LocationStep.svelte': [
    ['not chosen yet', locationStep(true)],
    ['no map', locationStep(false)],
  ],
};
