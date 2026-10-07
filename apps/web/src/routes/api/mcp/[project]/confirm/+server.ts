import { authorizeAdmin } from '$lib/server/authz';
import { createMcpHandlers } from '../../handler';
import { deps } from '../../source';

export const POST = createMcpHandlers(deps(authorizeAdmin)).confirm;
