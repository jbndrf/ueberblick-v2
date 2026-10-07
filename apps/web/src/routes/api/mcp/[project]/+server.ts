import { authorizeAdmin } from '$lib/server/authz';
import { json } from '$lib/server/handlers/http';
import { createMcpHandlers } from '../handler';
import { deps } from '../source';

export const POST = createMcpHandlers(deps(authorizeAdmin)).POST;
export const GET = () => json({ code: 'method_not_allowed', error: 'Send MCP messages with POST.' }, 405);
