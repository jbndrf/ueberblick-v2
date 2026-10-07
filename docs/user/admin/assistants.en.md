# Assistants (MCP)

An AI assistant can help you edit the project file. It reads the file, **proposes** changes and tries them in the simulator. It cannot change anything by itself: **you confirm** every change before it is saved. Nothing is deployed either; deploying is always your own action on the Versions page.

## What an assistant can do
| Tool | What it does | Stores anything? |
|---|---|---|
| `read_config` | The project file as it is in effect (whole, or one section such as `tasks`) | No |
| `read_problems` | The problems list you see in the builder | No |
| `read_schema` | What the file may contain (JSON Schema) | No |
| `propose` | Tries edits (ops) on the draft in memory: shows what changes, the new overlay text and the problems | No |
| `simulate` | Runs the file (with proposed edits) on a test feature: which tasks are offered, and a dry run of one | No |
| `apply` | Saves the edits to the draft | Yes, only with your confirmation |

## Connecting
The endpoint is `POST /api/mcp/<project>` (MCP over HTTP, JSON messages). You need to be signed in as an admin of the project, the same as for the builder. The assistant works on the project's one working draft, the one the builder shows.

## Confirming a change
1. The assistant shows you its proposal: the changes and the problems that result.
2. You confirm it in the builder. (For now this only checks that the request comes from the builder page itself; a stronger check is planned, decision A-018.) This gives the assistant a confirmation token valid for **10 minutes** and for exactly these edits on this state of the draft.
3. The assistant saves the change with `apply` and the token.

If someone changed the draft in the meantime, `apply` is refused (`stale_revision`) and nothing is written, exactly as when two people edit in the builder. The assistant then reads the draft again and proposes anew. The builder then shows "The draft was changed elsewhere. Reload to see the current version." with a "Reload" button.

## Limits
Assistant input is treated as untrusted: at most 50 edits at a time, at most 200,000 characters, values at most 32 levels deep and texts at most 16,384 characters. An expression an assistant writes may be at most 16,384 characters long and nested 16 levels deep (your own files allow more). A proposal that breaks a limit is refused with the reason.

The confirmation key is set by the server setting `UEBERBLICK_MCP_SECRET`. Without it, the server makes a new key at every start, so open proposals must be confirmed again after a restart.
