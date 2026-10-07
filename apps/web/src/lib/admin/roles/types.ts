/** What the Rollen page shows and sends. Plain data: it crosses from the server load to the browser. */

/** One person the members dialog can pick (v3 `data.participants`: the whole roster, guests included). */
export interface RolePerson {
  readonly id: string;
  readonly name: string;
}

/** One row of the roles table (v3 `Role` plus `assigned_participants`). */
export interface RoleRowData {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  /** The ids of the people who have this role. */
  readonly members: readonly string[];
  /** The role's Selbstbeitritt link (WP-639): `null` while it never had one. Roster side, not part of the draft (Q14). */
  readonly selfJoin: SelfJoinState | null;
  /** `roles.<key>.quota` of the draft; 0 = unbegrenzt. */
  readonly quota: number;
  /** The role's home view as the join dialog's "Landet auf" shows it; '' when none is set. */
  readonly home: string;
}

/** The switch and the slug of one role's link. A switched-off link keeps its slug, so printed posters work again. */
export interface SelfJoinState {
  readonly enabled: boolean;
  readonly slug: string;
}

export interface RolesPageData {
  readonly roles: readonly RoleRowData[];
  readonly people: readonly RolePerson[];
}

/** A problem the Doc reports for a deletion, in the page language. */
export interface RoleUse {
  readonly path: string;
  readonly message: string;
}

/** What the delete dialog shows: the problems (rules, permissions) and the people who have the role. */
export interface DeletePreview {
  readonly uses: readonly RoleUse[];
  readonly people: readonly RolePerson[];
}

/** The result of a call to the page's routes: done, or the refusal already in the page language. */
export type CallResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

/** The body of the page's `POST`: one role edit on the draft, or a look at what a deletion would break. */
export type RoleCall =
  | { readonly action: 'create'; readonly name: string; readonly description?: string }
  | { readonly action: 'update'; readonly key: string; readonly name?: string; readonly description?: string }
  | { readonly action: 'quota'; readonly key: string; readonly quota: number }
  | { readonly action: 'uses'; readonly keys: readonly string[] }
  | { readonly action: 'delete'; readonly keys: readonly string[] };
