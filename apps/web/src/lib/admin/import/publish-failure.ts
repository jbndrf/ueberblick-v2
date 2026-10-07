/**
 * What an import wizard says when 'Veröffentlichen und importieren' cannot publish (owner A4): the publish bar's
 * wording, with a link to the builder where the admin fixes the problem or moves values. Shared by the CSV and the
 * GeoJSON wizard (R1).
 */
import { adminMessage } from '../../../routes/(admin)/admin/shell/messages';
import type { Locale } from '../../../routes/(admin)/admin/shell/locale';
import { builderHref, type DraftStatusView } from '../draft/publish-client';
import type { DeployClient } from '../deploy/deploy-client';
import type { DeployAnswer } from '../deploy/types';

export interface PublishFailure {
  readonly text: string;
  readonly href?: string;
  readonly hrefLabel?: string;
}

/**
 * The wizards' publish: a deploy of the saved draft with no value move and no choice for running Objekte. What needs
 * either (a 409 `mapping_required`) is refused and sent to the builder by `publishFailure`; the deploy overview
 * (`../deploy/`) is where an admin makes those choices.
 */
export async function deployDraft(
  deployer: DeployClient,
  status: DraftStatusView | null,
): Promise<DeployAnswer> {
  if (status === null || status.revision === null) return { kind: 'failed' };
  return deployer.deploy({ revision: status.revision, mappings: {}, versions: {} });
}

/** `type` is the Objektart the wizard works on: the link target when the problem names none. */
export function publishFailure(
  locale: Locale,
  r: Exclude<DeployAnswer, { kind: 'deployed' }>,
  project: string,
  type: string,
): PublishFailure {
  const to = (typeKey: string | null): { href: string; hrefLabel: string } => ({
    href: builderHref(project, typeKey),
    hrefLabel: adminMessage(locale, 'draft_open_builder'),
  });
  switch (r.kind) {
    case 'mapping_required':
      return { text: adminMessage(locale, 'import_needs_mapping'), ...to(type) };
    case 'problems':
      return {
        text:
          r.count === 1
            ? adminMessage(locale, 'draft_problems_one')
            : adminMessage(locale, 'draft_problems_other', { count: r.count }),
        ...to(type),
      };
    case 'stale':
      return { text: adminMessage(locale, 'draft_stale') };
    default:
      return { text: adminMessage(locale, 'deploy_failed') };
  }
}
