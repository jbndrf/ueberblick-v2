// Sizes and dates of the Offline tab. v3's `formatFileSize` (SettingsSheet, package-selector) stopped at MB; a quota is
// gigabytes, so GB is added.
const UNITS = ['KB', 'MB', 'GB'] as const;

/** The number reads in the language of the app: "1,5 MB" in German, "1.5 MB" in English. */
export function formatBytes(bytes: number, locale: string): string {
  const digits = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (bytes < 1024)
    return `${new Intl.NumberFormat(locale, { useGrouping: false }).format(Math.round(bytes))} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${digits.format(value)} ${UNITS[unit]}`;
}

/** A day in the person's language ("1. Okt. 2026"); empty for a value that is no date. */
export function formatDay(iso: string, locale: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}
