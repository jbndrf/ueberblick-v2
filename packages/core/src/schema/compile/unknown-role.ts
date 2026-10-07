/** The one "this names a role the file does not declare" report (packs, participant `select`). */
import type { LocalizedString } from '../primitives';
import type { ProblemCode } from '../../registry/compile';
import type { ProblemParams } from './contract';
import type { Sink } from './problems';

export function refuseUnknownRole(
  sink: Sink,
  declared: readonly string[],
  role: string,
  path: string,
  code: ProblemCode,
  subject: { readonly en: string; readonly de: string },
  params: ProblemParams,
): void {
  if (declared.includes(role)) return;
  const message: LocalizedString = {
    en: `${subject.en}: '${role}' is not a role`,
    de: `${subject.de}: '${role}' ist keine Rolle`,
  };
  sink.error(
    path,
    code,
    message,
    declared.length > 0 ? `use one of: ${declared.join(', ')}` : 'declare the role first',
    {
      ...params,
      role,
      existing: declared.join(', '),
    },
  );
}
