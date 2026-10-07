import { localize, type Branding } from '@ueberblick/core';

/** German first: the participant app's default language; a name that is only given in another language is used as is. */
const NAME_LOCALES = ['de', 'en'] as const;

/**
 * The project as the participant bootstrap shows it (A-036, E-5): the deployed config's `branding.name` and
 * `branding.icon`, falling back to the project's name and no icon. The one place that decides it.
 */
export function projectInfoOf(
  projectName: string,
  branding: Branding | undefined,
): { readonly displayName: string; readonly icon: string | null } {
  const name = branding?.name === undefined ? '' : localize(branding.name, NAME_LOCALES).trim();
  return { displayName: name === '' ? projectName : name, icon: branding?.icon ?? null };
}
