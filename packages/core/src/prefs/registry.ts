// The enum values of the preference record live in the core registry (R6); this module only re-exports them so the
// `@ueberblick/core/prefs` subpath keeps its surface.
export {
  PREF_THEMES,
  PREF_FONT_SIZES,
  PREF_SECTIONS,
  type PrefTheme,
  type PrefFontSize,
  type PrefSection,
} from '../registry/prefs';
