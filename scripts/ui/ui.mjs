#!/usr/bin/env node
// node scripts/ui/ui.mjs <command> [args] [--json]   (also: npm run ui -- <command>)
// A thin client: the first call starts a detached session server (server.mjs) that keeps one Chromium
// page alive, every later call is one HTTP request to it. The command table lives in commands.mjs.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS, helpText } from './commands.mjs';
import { clearSession, readSession, stateDir } from './state.mjs';

const BOOL_FLAGS = ['json', 'full'];

export function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const name = a.slice(2);
      if (BOOL_FLAGS.includes(name)) flags[name] = true;
      else flags[name] = argv[++i];
    } else args.push(a);
  }
  return { cmd: args[0], args: args.slice(1), flags };
}

async function ping(session) {
  try {
    return (await fetch(`http://127.0.0.1:${session.port}/`)).ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  const existing = readSession();
  if (existing !== undefined) {
    if (await ping(existing)) return existing;
    clearSession();
  }
  const log = openSync(join(stateDir(), 'server.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  child.unref();
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const s = readSession();
    if (s !== undefined && (await ping(s))) return s;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`the session server did not start (see ${join(stateDir(), 'server.log')})`);
}

async function main() {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));
  if (cmd === undefined || cmd === 'help') {
    console.log(`usage: node scripts/ui/ui.mjs <command> [--json]\n${helpText()}`);
    return 0;
  }
  if (!COMMANDS.some((c) => c.name === cmd)) {
    console.error(`unknown command ${cmd}\n${helpText()}`);
    return 2;
  }
  let session;
  if (cmd === 'stop') {
    session = readSession();
    if (session === undefined || !(await ping(session))) {
      console.log('no session running');
      return 0;
    }
  } else session = await ensureServer();
  const res = await fetch(`http://127.0.0.1:${session.port}/cmd`, {
    method: 'POST',
    body: JSON.stringify({ cmd, args, flags }),
  });
  const out = await res.json();
  if (flags.json) console.log(JSON.stringify(out));
  else console.log(out.ok ? out.text : `error: ${out.error}`);
  if (cmd === 'stop') {
    const until = Date.now() + 10_000;
    while (readSession() !== undefined && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  }
  return out.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main());
