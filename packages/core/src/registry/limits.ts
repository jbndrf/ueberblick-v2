/**
 * Platform limits that bound one interaction's work (R14). A change to a number is a registry edit, never a
 * literal in plan code.
 */

/**
 * Most features one `then` step with `of` may act on (A-035). A larger target list is refused with
 * `too_many_targets`: a fan-out over thousands of features is an import or a migration, not a task step.
 */
export const THEN_STEP_TARGETS_MAX = 100;

/**
 * Project keys no project may have (WP-424): the server keeps `blobs/<project>` next to `blobs/tiles` and
 * `blobs/packs`, so a project with one of these keys would own (and delete) every project's tile or pack files.
 */
export const RESERVED_PROJECT_KEYS = ['tiles', 'packs'] as const;

/** How far ahead of the server clock a participant's client time may be (device clocks drift). Later times are clamped (WP-762). */
export const AUDIT_CLOCK_SKEW_MS = 5 * 60 * 1000;
/**
 * How far behind the server clock a participant's client time may be: offline work arrives days or weeks late, but a
 * time older than this is not offline work, it is a forged creation time. Earlier times are raised to the bound (WP-762).
 */
export const AUDIT_MAX_OFFLINE_AGE_MS = 366 * 24 * 60 * 60 * 1000;
