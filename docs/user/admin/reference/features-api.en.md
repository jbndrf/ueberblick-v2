# API reference: the feature list

The data table of the admin area shows the features of one feature type, page by page. These endpoints answer it and the page of one object. They need an admin session (the `ub_session_admin` cookie) with access to the project.

| Endpoint | Answer |
|---|---|
| `GET /api/admin/p/<project>/features` | `{ "rows": [...], "next": "<cursor>" or null, "total": 60000 }` |
| `GET /api/admin/p/<project>/features/distinct` | `[ { "value": "...", "count": 12 }, ... ]`, at most 500 values |
| `GET /api/admin/p/<project>/features/<id>/history` | `{ "runs": [...], "next": "<cursor>" or null }`, the runs on one feature |
| `POST /api/admin/p/<project>/features/<id>/correct` | `{ "runId", "seq" }`, the admin correction |
| `POST /api/admin/p/<project>/features` | `{ "runId", "id" }`, a new row (admin creation) |
| `POST /api/admin/p/<project>/features/<id>/lifecycle` | `{ "runId" }`, sets a feature to deleted |

## Parameters of `features`

| Parameter | Meaning |
|---|---|
| `type` | the feature type (required) |
| `q` | search: case-insensitive substring in the text properties (text, choice, number) and in the creator column; letters outside A-Z (such as ä) match only in the same case |
| `sort`, `dir` | the column and `asc` (default) or `desc`; rows without a value come first in `asc` and last in `desc`; text sorts without regard to case |
| `filter.<column>` | the wanted values, separated by commas (`filter.stage=erfasst,geprueft`); a comma inside a value is written `\,`; `__empty__` matches rows without a value; several `filter.` parameters combine with AND, the values of one with OR |
| `lifecycle` | the states to show, separated by commas: `active`, `completed`, `archived`, `deleted`. Without it everything except `deleted` is shown |
| `limit` | rows per page, 1 to 500 (default 50) |
| `cursor` | the `next` value of the previous page; it only fits the same `sort` and `dir` |

Columns are the property keys of the type and the system columns `$id`, `$lifecycle`, `$created_by`, `$created_at` and `$changed_at`. The same `$` key is used in `sort`, `filter.`, `column`, the cursor and a row; a property key never starts with `$`, so a property called `id` or `lifecycle` stays a column of its own. A property of type `multiselect` can be filtered but not sorted; `localized_text` and `file` can be neither sorted nor filtered. Values of boolean columns are filtered as `true` and `false`; numbers as numbers.

A row holds the property values (without the geometry), `$id`, `$lifecycle`, `$created_by`, `$created_at`, `$changed_at`, `$seq` and the anchor point as `lon` and `lat`. `$seq` is the value that `expected_seq` in `features/<id>/correct` is checked against; it is not a column and cannot be sorted or filtered. `total` counts every row that matches the filters, over all pages.

Paging does not use an offset: a page costs the same at any depth, and rows written meanwhile never make a row appear twice or get skipped.

## `features/distinct`

Takes `type`, `column` and the same `q`, `filter.<column>` and `lifecycle` as the list. It returns the values of the column with their counts, the most frequent first. The filter of the column itself is ignored, so a filter menu can still offer the other values. `value` is `null` for rows without a value.

## `features/<id>/history`

The runs on one feature, newest first: `{ "runs": [...], "next": "<cursor>" or null }`, at most 50 per page; `cursor` is the `next` value of the previous page (no other parameter is allowed). The feature may be in any lifecycle state, deleted too; an unknown id answers `not_found` (404). A run has `id`, `task`, `actor` (`id`, `kind`, `name` or `null`; for a run made by an admin, `name` is the account's e-mail), `receivedAt`, `clientTime` (`null` for a run made on the server), `configVersion`, `outcome` (`accepted` or `refused`), for `refused` the `refusal` (`code`, `message`), and the `observations` (`property`, `result`, `time`) it wrote on this feature (empty for a refused run). It lists the runs that were about a feature (`runs.feature_id`); a refused run that tried to create a feature belongs to no feature and appears in no list.

## `features/<id>/correct`

`POST` with `{ "values": { "<property>": value }, "expected_seq": 12 }` (`expected_seq` is optional). Admins of the project only. One call is **one run** of the system task "Admin correction" (`$correct`) on the object: every value is checked against its property; the stage, `$` keys, unknown properties and values that do not fit are refused. An empty value clears the property; an unchanged one writes nothing. Rules and computed values react as to any run. `expected_seq` is the row's `$seq` from the list; when it no longer matches, the answer is `conflict` (409) and nothing is written. Answer: `{ "runId", "seq" }` (`seq` is the object's new `$seq`). A refusal is `run_refused` (422) with `issues: [{ "path": "input.values.<property>", "message" }]`; `invalid_body` (400) for a body without `values`; 404 for an unknown object. The list's rows carry `$seq` for this.

## `features` (POST)

`POST` with `{ "type": "<feature type>", "values": { "<property>": value } }`. Admins of the project only. One call is **one run** of the system task Admin creation (`$create`): a new feature of the type, with `$type` and its creator. Every value is checked against its property; empty values are left out, properties without a value get their default, and a missing required property is refused (`required_missing`). The stage cannot be set (it starts at the process start). Answer `201` with `{ "runId", "id" }`. A refusal is `run_refused` (422) with `issues`; `invalid_body` (400) without `type` or `values`; 404 for an unknown feature type; `conflict` (409) before the first publish. A table's page uses it for "Add row".

## `features/<id>/lifecycle`

`POST` with `{ "state": "deleted" }` (or `active`, `completed`, `archived`). Admins only. One call is **one run** of the system task "Lifecycle" (`$lifecycle`) on the feature; the same state writes nothing. Answer `{ "runId" }`; `invalid_body` (400) for an unknown state; 404 for an unknown feature. A table's page uses it for "Delete row".

## Errors

An error is `{ "error": { "code", "message" } }`: `invalid_query` (400) for an unknown parameter or column, `not_found` (404) for an unknown type, `conflict` (409) before the first deploy, 401 and 403 without an admin session for the project.
