# Connect QGIS

QGIS reads and edits your project's features through the standard OGC API Features. Every change QGIS makes becomes a run, so the same tasks, permissions and rules apply as in the app.

## Connect

With a token (recommended): under **Project settings, GIS access** create a token for the participant whose permissions QGIS should get (see [Project settings](project-settings.en.md)).

1. Data Source Manager, **WFS / OGC API - Features**, New connection. URL: `https://<server>/api/p/<project>/ogc`.
2. Authentication: **Basic**, user name = the token (`ubk_…`), password empty. (An `Authorization: Bearer <token>` header works as well.)
3. Connect. Each feature type the participant may see is one collection (layer), labelled as in the project, in the language of the `Accept-Language` header (else German, then English, then the first one defined).

The token works until you **Revoke** it or it expires. A participant token reads **and writes**, with exactly that participant's permissions: QGIS may create or change only what the participant may do in the app (see below). For **admin permissions** (see and change everything; also for scripts and services such as a nightly data service) choose **Admin (my permissions)** when you create the token: it belongs to your admin account and is valid only in this project; connect as above (Basic, token as user name). Writes run as tasks with your admin account as the actor. The token ends when you revoke it or when your account is blocked or deleted. You no longer need to copy a cookie.

## What you can do

- **Read:** features clipped to what your roles may see, with only the properties your roles may read. Panning the map asks for a bbox; QGIS pages through large layers by itself (`limit`, `next`).
- **Coordinates:** GeoJSON in WGS84 (CRS84, longitude/latitude) by default. Each collection lists the other coordinate systems (`crs`): `EPSG:4326` (latitude/longitude order) and the projected ones such as `EPSG:25832`. QGIS picks one in the layer's CRS setting. `bbox-crs` and the `Content-Crs` header of a write use the same list.
- **Filters:** QGIS's feature filter (CQL2) narrows a layer on the server, by property or by area. A filter with an area condition needs a bbox or a geometry, so that not every feature has to be checked; too broad a filter answers `422` (`filter_too_broad`).
- **Create and change:** with a participant token or an admin session. QGIS sends the changed properties; Überblick runs the one task that carries the change, as that participant (history shows the participant) or as the admin. The task's roles, conditions, field permissions and rules apply as in the app, and computed values are filled in. If no task, or several tasks, fit, the answer is `422` and lists the candidates. Add `?task=<key>` to the URL of the request to choose one.
- **Not allowed:** a participant who may not run the task, may not write a property, or may not see the feature type gets `403` (`forbidden`) with the reason and the property; nothing is stored.
- **Refused:** any other refused run (for example a missing required value) answers `422` (`run_refused`) with the refusal code and reason. Nothing is stored except the refused run.

## What is not possible yet

- Deleting features works only if the type has a task that has at least one step without `of` and whose steps without `of` all set the lifecycle to deleted (`lifecycle: deleted`); QGIS then runs it and the feature is no longer served. Without such a task QGIS shows the refusal.
- Other coordinate systems than the ones a collection lists are refused with `400`.
- Feature types that nobody can see are not listed.

## Conformance

`GET /api/p/<project>/ogc/conformance` lists the conformance classes this server claims. Today: OGC API Features Part 1 Core and GeoJSON, Part 2 CRS, Part 3 filtering with CQL2, Part 4 create, replace, update and delete (delete needs a delete task, see above).

## Errors

Errors are `{ "error": { "code", "message", "issues" } }`. Codes: `unauthenticated` (401), `forbidden` (403), `not_found` (404), `method_not_allowed` (405), `invalid_query` (400, unknown or malformed parameter), `invalid_body` (400), `run_refused` (422), `no_write_task` (422), `filter_too_broad` (422), `conflict` (409, no config deployed).
