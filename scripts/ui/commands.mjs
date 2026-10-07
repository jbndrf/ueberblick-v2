// The command table: the one place that says which tools ui.mjs offers (part C lists them for the model).
// Each entry: {name, usage, summary, run(session, args, flags) -> {text, data?}}. The session holds the page,
// the last snapshot's nodes, the console and network buffers and the run directory.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appendAction, byRef, logLocator } from './locator.mjs';
import { collect, render } from './snapshot.mjs';

export const VIEWPORTS = { '360x800': { width: 360, height: 800 }, '1280x800': { width: 1280, height: 800 } };
const ACTION_TIMEOUT_MS = 5000;
const REF = /^e\d+$/;

function need(args, n, usage) {
  if (args.length < n) throw new Error(`usage: ui.mjs ${usage}`);
}

/** Resolves a ref, runs the action, and appends the action-log line with the locator actually used. */
async function act(s, cmd, ref, args, run) {
  if (!REF.test(ref ?? '')) throw new Error(`"${ref}" is not a ref (e1, e2, ...): run snapshot first`);
  const node = s.nodes[Number(ref.slice(1)) - 1];
  const target = byRef(s.page, ref);
  if ((await target.count()) === 0) throw new Error(`${ref} is gone: run snapshot again`);
  const { locator, warning } = await logLocator(s.page, ref, node);
  const url = s.page.url();
  await run(target);
  appendAction(s.runDir, { at: new Date().toISOString(), cmd, ref, locator, args, url });
  const label = node.name ? `${node.role} "${node.name}"` : node.role;
  return {
    text: `${cmd} ${ref} (${label})${warning ? `\nwarning: ${warning}` : ''}`,
    data: { locator, warning },
  };
}

function logPlain(s, cmd, args) {
  appendAction(s.runDir, {
    at: new Date().toISOString(),
    cmd,
    ref: null,
    locator: null,
    args,
    url: s.page.url(),
  });
}

const drain = (list) => list.splice(0, list.length);

async function runAxe(s) {
  const source = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
  await s.page.evaluate(source);
  const result = await s.page.evaluate(() => globalThis.axe.run());
  const violations = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  const text = violations.length
    ? violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.join('; ')})`).join('\n')
    : 'no axe violations';
  return { text, data: { violations } };
}

export const COMMANDS = [
  {
    name: 'open',
    usage: 'open <url> [--viewport 360x800|1280x800]',
    summary: 'Go to a URL, optionally at a phone or desktop viewport.',
    async run(s, [url], flags) {
      need([url], 1, this.usage);
      if (flags.viewport !== undefined) {
        const vp = VIEWPORTS[flags.viewport];
        if (vp === undefined) throw new Error(`viewport must be one of ${Object.keys(VIEWPORTS).join(', ')}`);
        await s.page.setViewportSize(vp);
      }
      const res = await s.page.goto(url, { waitUntil: 'load' });
      logPlain(s, 'open', [url]);
      return {
        text: `opened ${s.page.url()} (HTTP ${res?.status() ?? '?'})`,
        data: { status: res?.status() },
      };
    },
  },
  {
    name: 'snapshot',
    usage: 'snapshot',
    summary: 'Interactive and landmark nodes with refs e1, e2, ... (valid until the next snapshot).',
    async run(s) {
      s.nodes = await s.page.evaluate(collect);
      const { text, truncated } = render(s.nodes);
      return { text: `url: ${s.page.url()}\n${text}`, data: { nodes: s.nodes.length, truncated } };
    },
  },
  {
    name: 'click',
    usage: 'click <ref>',
    summary: 'Click the element behind a ref.',
    run: (s, [ref]) => act(s, 'click', ref, [], (el) => el.click({ timeout: ACTION_TIMEOUT_MS })),
  },
  {
    name: 'fill',
    usage: 'fill <ref> <text>',
    summary: 'Replace the text of an input.',
    run(s, [ref, ...rest]) {
      need([ref, ...rest], 2, this.usage);
      const text = rest.join(' ');
      return act(s, 'fill', ref, [text], (el) => el.fill(text, { timeout: ACTION_TIMEOUT_MS }));
    },
  },
  {
    name: 'press',
    usage: 'press <key>',
    summary: 'Press a key on the page, for example Enter or Control+a.',
    async run(s, [key]) {
      need([key], 1, this.usage);
      await s.page.keyboard.press(key);
      logPlain(s, 'press', [key]);
      return { text: `pressed ${key}` };
    },
  },
  {
    name: 'select',
    usage: 'select <ref> <value>',
    summary: 'Choose an option (by value or label) in a select.',
    run(s, [ref, ...rest]) {
      need([ref, ...rest], 2, this.usage);
      const value = rest.join(' ');
      return act(s, 'select', ref, [value], (el) => el.selectOption(value, { timeout: ACTION_TIMEOUT_MS }));
    },
  },
  {
    name: 'screenshot',
    usage: 'screenshot [--full]',
    summary: 'Write a PNG and print its path.',
    async run(s, _args, flags) {
      const path = join(s.runDir, 'shots', `${String(++s.shots).padStart(3, '0')}.png`);
      await s.page.screenshot({ path, fullPage: flags.full === true });
      return { text: path, data: { path } };
    },
  },
  {
    name: 'console',
    usage: 'console',
    summary: 'Console errors, warnings and page errors since the last call.',
    async run(s) {
      const lines = drain(s.consoleLog);
      return { text: lines.length ? lines.join('\n') : 'no console errors or warnings', data: { lines } };
    },
  },
  {
    name: 'network',
    usage: 'network',
    summary: 'Failed requests (status 400 or more, or no response) since the last call.',
    async run(s) {
      const lines = drain(s.netLog);
      return { text: lines.length ? lines.join('\n') : 'no failed requests', data: { lines } };
    },
  },
  {
    name: 'axe',
    usage: 'axe',
    summary: 'Accessibility violations of the current page (axe-core), violations only.',
    run: (s) => runAxe(s),
  },
  {
    name: 'wait',
    usage: 'wait <text|ref>',
    summary: 'Wait until the text appears, or the ref is visible.',
    async run(s, args) {
      need(args, 1, this.usage);
      const what = args.join(' ');
      if (REF.test(what)) {
        await byRef(s.page, what).waitFor({ state: 'visible', timeout: 10_000 });
        const { locator } = await logLocator(s.page, what, s.nodes[Number(what.slice(1)) - 1]);
        appendAction(s.runDir, {
          at: new Date().toISOString(),
          cmd: 'wait',
          ref: what,
          locator,
          args: [],
          url: s.page.url(),
        });
      } else {
        await s.page.getByText(what).first().waitFor({ state: 'visible', timeout: 10_000 });
        logPlain(s, 'wait', [what]);
      }
      return { text: `found ${what}` };
    },
  },
  {
    name: 'seed',
    usage: 'seed <fixture>',
    summary:
      'A fresh project from fixtures/golden/projects/<fixture>.yaml, served locally, browser signed in.',
    async run(s, [fixture]) {
      need([fixture], 1, this.usage);
      const { seed } = await import('./seed.mjs');
      const res = await seed(s, fixture);
      logPlain(s, 'seed', [fixture]);
      return res;
    },
  },
  {
    name: 'help',
    usage: 'help',
    summary: 'List the commands.',
    run: () => ({ text: helpText() }),
  },
  {
    name: 'stop',
    usage: 'stop',
    summary: 'End the session (the server exits, the browser closes).',
    run: () => ({ text: 'stopped' }),
  },
];

export function helpText() {
  return COMMANDS.map((c) => `  ${c.usage.padEnd(44)} ${c.summary}`).join('\n');
}
