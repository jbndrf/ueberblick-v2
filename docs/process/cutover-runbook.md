# Cutover runbook: v3 to v4

How a real v3 project moves to v4. Every step names its command. All commands run from the repository root as `npm run migrate -w @ueberblick/migrate -- <command>` (short: `migrate <command>`); the tool is `apps/migrate` (`apps/migrate/README.md`).

**Needs-owner steps** are marked **[NEEDS-OWNER]**. They need real v3 data, credentials or a decision about production, so no agent runs them: **the export of the real v3 project (step 1), the pilot (step 5) and the cutover (step 7)**. Everything else has been run on the synthetic fixtures (`fixtures/v3-synthetic/`) and is proven by the dry run.

## 0. Rehearse on synthetic data

`migrate dry-run [fixture]` (default `baumkontrolle`) runs steps 2 to 4 on a synthetic project, then a check that every carried record is a live feature, into a temporary database: convert, differential check, import project, data migration, verify. Exit code 0 means the whole chain works on this checkout. Run it before every pilot; it proves the tool, not the customer's data. The test is `apps/migrate/src/dry-run/dry-run.spec.ts`.

## 1. Export from v3 **[NEEDS-OWNER]**

Needs access to the production v3 project. Produce three files and keep them read-only:

| File                   | Content                                                                  | Format                                                        |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `v3-project.yaml`      | the project definition (`format: 1`)                                     | `apps/migrate/README.md`, "Contract"                          |
| `v3-data.yaml`         | instances with their field value log, and rows of custom tables          | `apps/migrate/README.md`, "Data conversion"                   |
| `v3-runs.yaml`         | recorded task runs: who ran which task on which instance, and the result | `apps/migrate/README.md`, "Differential check", `V3Run`       |

Freeze v3 writes for the duration of the export (otherwise data and runs disagree). Note the time of the export. Nothing in v3 is changed. Files (photos) are not part of the export; plan their transfer separately (the data report lists them as `not_carried`).

## 2. Convert the configuration

`migrate convert v3-project.yaml --out work/convert`

Writes `template.yaml`, `overlay.yaml`, `report.json` and `mapping.json`. Exit 0 means the converted project compiles and the report accounts for every v3 item. Read the report: first every `dropped` item, then every `approximated` one, and decide for each whether to rebuild it by hand in the builder. Put the decisions in the pilot log.

## 3. Differential check

`migrate diffcheck v3-project.yaml v3-runs.yaml`

Replays the recorded runs through the converted project. Exit 0 means no difference is `unexplained`. Every `unexplained` difference blocks the pilot: fix the conversion, note it as `known` in the runs file with the reason, or correct a wrong recording. Differences that are `reported` or `not_convertible` are reviewed with the report from step 2.

## 4. Import into a copy of v4

`migrate import v3-project.yaml v3-data.yaml --dir work/pilot --key <project>`

Converts the data into import runs and submits them into `work/pilot/project-<key>.db`. It is resumable and safe to repeat: run ids derive from the v3 ids. Exit 1 means the server refused a run; the output lists every problem by v3 id. The import store is the server's one store composition (`composeProjectStore`), but the import project carries no rules, so the import itself schedules no timers: they are created when the next step deploys the full project. Then deploy `work/convert/template.yaml` plus `overlay.yaml` as the project config (the full project, with rules) as usual (`docs/user/admin/how-to/deploy.md`). The deploy path is `deployProject` (`packages/server/src/deploy/deploy-project.ts`), whichever door you use: `POST /api/admin/p/<key>/deploy` or the builder's Versions area (deploy, rollback, upgrade). It rebuilds the timers of every migrated feature and the cron rows, so no restart is needed; do not skip this step, or migrated features have no elapsed timers.

## 5. Pilot on a copy **[NEEDS-OWNER]**

Run v4 for real users on the copy from step 4, while v3 stays the system of record. Nothing done in the pilot is carried to production.

1. Two to four people per role (field, office, admin) work through their normal tasks for at least one working week, on devices they use daily, including offline.
2. Compare on the same day: object counts per type, ten hand-picked objects with their history, the map view, and one export.
3. Keep a pilot log: each finding with role, task, expected and observed, and severity.

## 6. Sign-off criteria

All of these hold before the cutover; the owner signs, the checks are commands or lists:

- [ ] `migrate convert` exits 0 and every `dropped` and `approximated` item has a written decision (rebuilt, accepted, or not needed).
- [ ] `migrate diffcheck` exits 0: no `unexplained` difference, and every `known` note names its follow-up.
- [ ] `migrate import` reported no `refused` run; every other data problem (no position, missing option, dropped reference) is either fixed at the source or accepted in writing.
- [ ] Object counts per type in v4 equal the v3 counts minus the accepted problems.
- [ ] Pilot: no open finding of severity blocker or major; every role completed its normal tasks.
- [ ] Restore drill passed on the target server (`docs/process/backup.md`), and the last backup is younger than one day.
- [ ] Files (photos) are transferred and checked, or the owner accepts that they stay in v3.
- [ ] The rollback (step 8) was read by whoever will execute it.

## 7. Cutover **[NEEDS-OWNER]**

Choose a low-traffic window and announce it.

1. Freeze v3: switch it to read-only and note the time. Nothing is deleted.
2. Export again (step 1) and repeat steps 2 to 4 against a **new** database (`--dir work/production`), with the conversion decisions of the pilot. The freeze means this export is final.
3. Deploy the full project (step 4) and take a backup of the fresh database.
4. Smoke test as each role: sign in, open the map, run one task, sync a device that was offline.
5. Hand out access (QR login, `docs/user/admin/how-to/qr-login.md`), point the address to v4, and tell users.

## 8. Rollback

Until v3 is switched off, rollback costs nothing: v3 was only frozen, never changed.

- **Before users work in v4** (steps 7.1 to 7.4): stop, discard `work/production`, switch v3 back to read-write. Nothing was written to v3.
- **After users worked in v4:** work done in v4 does not flow back to v3 (there is no reverse migration). Decide within the first working day: either fix forward in v4, or switch v3 back and re-enter the v4 work by hand from the v4 export (`docs/user/admin/how-to/import-export.md`). After that day, only fix forward.
- Keep v3 and its backups untouched, read-only, for at least 30 days after the cutover. Switch it off only after the owner has confirmed in writing.

## Commands at a glance

| Step | Command                                                              | Proves                                        |
| ---- | -------------------------------------------------------------------- | --------------------------------------------- |
| 0    | `migrate dry-run [fixture]`                                          | the tool chain works                          |
| 2    | `migrate convert <v3-project> --out <dir>`                           | project compiles, report complete             |
| 3    | `migrate diffcheck <v3-project> <v3-runs>`                           | behaviour agrees or is explained              |
| 4    | `migrate import <v3-project> <v3-data> --dir <dir> [--key <key>]`    | data carried, no run refused                  |
| 5, 7 | none: people and production                                          | **[NEEDS-OWNER]**                             |
