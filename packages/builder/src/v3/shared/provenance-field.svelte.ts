/**
 * The provenance of a form field card (WP-445): the field is its property and its entry in the task's form, the two
 * places it is edited. Called once by the card; the "⋯" menu reads the same through the context.
 */
import { formatKeyPath } from '@ueberblick/core';
import { commitForm } from '../form/commit';
import type { BuilderContext } from '../shell/context';
import { subjectTypeOf } from '../task/step-ops';
import { provenanceOf, resetOps, type ProvenanceInfo } from './provenance';
import { provideProvenance } from './provenance-context';

export interface FieldProvenance {
  readonly info: ProvenanceInfo | undefined;
  /** Why the last reset did not apply. */
  readonly error: string | undefined;
}

export function fieldProvenance(ctx: BuilderContext, key: () => string): FieldProvenance {
  const task = $derived(ctx.selection().kind === 'form' ? (ctx.selection().id ?? '') : '');
  const paths = $derived([
    formatKeyPath(['types', subjectTypeOf(ctx.doc().effective(), task, ctx.type), 'properties', key()]),
    formatKeyPath(['tasks', task, 'form', key()]),
  ]);
  const info = $derived(provenanceOf(ctx.doc(), paths));
  let error: string | undefined = $state();
  provideProvenance({
    info: () => info,
    reset: () => {
      error = commitForm(ctx, resetOps(ctx.doc(), paths), `tasks.${task}`);
    },
  });
  return {
    get info() {
      return info;
    },
    get error() {
      return error;
    },
  };
}
