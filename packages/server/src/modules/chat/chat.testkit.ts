import type { Key, TemplateFile } from '@ueberblick/core';
import { createAuth, isAuthError, type Auth } from '../../auth';
import { openControlDb, openProjectDb } from '../../db/open';
import type { DeployedConfig } from '../../sync';
import { createChatHandlers } from './handlers';

export const NOW = '2026-10-02T08:00:00.000Z';
export const FEATURE = '0192f3a4-7b1c-7e2a-9d3f-5a6b7c8d9e0f';

const fileWith = (
  tools: Record<string, unknown> | undefined,
  projectTools: Record<string, unknown> = { chat: {}, measure: {} },
): TemplateFile =>
  ({
    schema: 'ueberblick/1',
    tools: projectTools,
    roles: {
      melder: { app: { tools: { chat: { availability: 'offered' } } } },
      leser: { app: tools === undefined ? {} : { tools } },
      nur: { app: { tools: { measure: {} } } },
    },
  }) as unknown as TemplateFile;

/** Project `trees` with participants mia, bernd (role melder: chat offered), lena (leser: chat active), otto (nur: no chat). */
export async function chatWorld(opts: { deployed?: boolean } = {}) {
  const control = openControlDb(':memory:');
  for (const [id, key] of [
    ['p1', 'trees'],
    ['p2', 'other'],
  ] as const)
    control
      .prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)')
      .run(id, key, key, 'x');
  const roles: Record<string, Key> = {
    mia: 'melder',
    bernd: 'melder',
    lena: 'leser',
    otto: 'nur',
    zoe: 'melder',
  } as never;
  const auth: Auth = createAuth({
    control,
    now: () => new Date(NOW),
    participantRoles: (_p: string, who: string) => [roles[who] ?? ('melder' as Key)],
  });
  const session = (projectId: string, who: string): string => {
    const s = auth.exchange(auth.issueCredential(projectId, who).token);
    if (isAuthError(s)) throw new Error(s.code);
    return `ub_session_participant=${s.id}`;
  };
  const adminId = await auth.createAdmin('a@example.org', 'correct horse battery');
  control
    .prepare('INSERT INTO memberships (account_id, project_id, role) VALUES (?,?,?)')
    .run(adminId, 'p1', 'verwaltung');
  const db = openProjectDb(':memory:', 'trees');
  for (const [id, name, role] of [
    ['mia', 'Mia', 'melder'],
    ['bernd', 'Bernd', 'melder'],
    ['lena', 'Lena', 'leser'],
    ['otto', 'Otto', 'nur'],
  ] as const)
    db.prepare('INSERT INTO participants (id, name, roles) VALUES (?,?,?)').run(id, name, `["${role}"]`);
  db.prepare(`INSERT INTO participants (id, name, roles) VALUES ('anon', NULL, '["melder"]')`).run();
  db.prepare(
    `INSERT INTO participants (id, name, roles, disabled_at) VALUES ('gone', 'Gone', '["melder"]', 'x')`,
  ).run();
  db.prepare("INSERT INTO participants (id, name, roles, hidden) VALUES ('ghost', 'ghost', '[]', 1)").run();
  db.prepare(
    'INSERT INTO features (id, type, config_version, properties, updated_seq) VALUES (?, ?, 1, ?, 1)',
  ).run(FEATURE, 'baum', '{}');
  let file: TemplateFile = fileWith({ chat: { availability: 'active' } });
  const rang: string[] = [];
  const handlers = createChatHandlers({
    auth,
    project: (key) =>
      control.prepare<{ id: string; key: string }>('SELECT id, key FROM projects WHERE key = ?').get(key),
    clock: { now: () => NOW },
    projectDb: () => db,
    deployed: () =>
      opts.deployed === false ? undefined : ({ version: 1, config: { file } } as unknown as DeployedConfig),
    ringTool: (project, tool) => rang.push(`${project}:${tool}`),
  });
  const cookies = {
    mia: session('p1', 'mia'),
    bernd: session('p1', 'bernd'),
    lena: session('p1', 'lena'),
    otto: session('p1', 'otto'),
    zoe: session('p2', 'zoe'),
    admin: `ub_session_admin=${auth.openAdminSession(adminId).id}`,
  };
  type Call = { cookie?: string; project?: string; tool?: string; query?: string; body?: unknown };
  const request = (kind: 'list' | 'send' | 'read', o: Call = {}): Promise<Response> => {
    const project = o.project ?? 'trees';
    const tool = o.tool ?? 'chat';
    const path = kind === 'read' ? `${tool}/read` : tool;
    return handlers[kind](
      new Request(`http://x/api/p/${project}/tools/${path}${o.query ?? ''}`, {
        method: kind === 'list' ? 'GET' : 'POST',
        headers: { ...(o.cookie ? { cookie: o.cookie } : {}), 'content-type': 'application/json' },
        ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
      }),
      { params: { project, tool } },
    );
  };
  return {
    db,
    cookies,
    rang,
    request,
    setTools: (
      tools: Record<string, unknown> | undefined,
      o: { projectTools?: Record<string, unknown> } = {},
    ) => void (file = fileWith(tools, o.projectTools)),
    send: (cookie: string, id: string, body: string) => request('send', { cookie, body: { id, body } }),
  };
}
