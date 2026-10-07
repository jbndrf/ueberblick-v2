/**
 * A `datetime` template input is stored as an ISO instant (with a zone); the `datetime-local` field shows and gives
 * the admin's local time without a zone. These convert both ways, so a stored instant with an offset shows and
 * saves as the same instant (WP-479).
 */
const pad = (n: number): string => String(n).padStart(2, '0');

/** The input text (`YYYY-MM-DDTHH:mm`, the admin's local time) for an ISO instant; empty when it is not one. */
export function instantToLocalInput(instant: unknown): string {
  if (typeof instant !== 'string' || instant === '') return '';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The ISO instant for a input text in the admin's local time; empty text stays empty, an unreadable one is null. */
export function localInputToInstant(local: string): string | null {
  if (local.trim() === '') return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The value to save for a datetime field: the stored instant itself while the field still shows it (so seconds and
 * zone survive an untouched save), else the edited local time as an instant.
 */
export function datetimeToSave(stored: unknown, field: string): string | null {
  if (typeof stored === 'string' && field === instantToLocalInput(stored)) return stored;
  return localInputToInstant(field);
}
