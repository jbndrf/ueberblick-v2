/** What the Teilnehmende page shows and sends. Plain data: it crosses from the server load to the browser. */

/** A role the Rollen cell offers. `pending`: it exists only in the draft and is active once published (Q13). */
export interface RoleOption {
  readonly key: string;
  readonly label: string;
  readonly pending: boolean;
}

/** A column the admin added (WP-310's column definition). `type` is a key of the server's column-type registry. */
export interface CustomColumn {
  readonly key: string;
  readonly label: string;
  readonly type: string;
  readonly default?: string | number | boolean;
  readonly required?: boolean;
}

/** One person on the roster. `token` is the readable login token, `null` when the person has none. */
export interface RosterPerson {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly roles: readonly string[];
  readonly attrs: Readonly<Record<string, string | number | boolean>>;
  readonly disabledAt: string | null;
  readonly selfJoined: boolean;
  readonly token: string | null;
}

export interface ParticipantsPageData {
  readonly people: readonly RosterPerson[];
  readonly roles: readonly RoleOption[];
  readonly columns: readonly CustomColumn[];
  /** The registry keys of the column types, for the manager's type menu. */
  readonly columnTypes: readonly string[];
  readonly showGuests: boolean;
}

/** The result of a call to the admin routes: done, or the server's refusal in the page language. */
export type CallResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };
