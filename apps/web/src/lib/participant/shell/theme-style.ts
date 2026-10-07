import { THEMES, themeVars } from '@ueberblick/ui';

/** The part of the document root the tokens go onto (a real `HTMLElement` fits). */
export interface TokenRoot {
  readonly style: { setProperty(name: string, value: string): unknown };
}

/**
 * The one place that sets the `--ub-*` design tokens of the participant app (WP-714): on the document root, so sheets,
 * menus and dialogs that render into `<body>` and the pages outside the map inherit them. The sign-in page applies
 * the normal theme; the map applies the role's theme as soon as it is known. A new call replaces the earlier values. Returns the undo (the normal
 * theme again), so a Svelte `$effect` can return the call and the sign-in page after a logout is not outdoor.
 */
export function applyThemeTokens(root: TokenRoot, theme: keyof typeof THEMES): () => void {
  for (const [name, value] of Object.entries(themeVars(THEMES[theme]))) root.style.setProperty(name, value);
  return () => {
    if (theme !== 'normal') applyThemeTokens(root, 'normal');
  };
}
