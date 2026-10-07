/** Where the device sync pipeline runs (B-012). Internal tags of the host adapter, not domain values. */
export const HOST_KINDS = ['in-thread', 'worker'] as const;
export type HostKind = (typeof HOST_KINDS)[number];

/** `tabs` value of a host that is deliberately the only tab of its database (Node, tests, single-tab shells): it always pulls itself. */
export const SINGLE_TAB = 'single-tab' as const;

/** The two kinds by name, typed as their literals, so option types and comparisons never repeat the strings. */
export const [IN_THREAD, WORKER] = HOST_KINDS;
