// The journey runner (docs/process/journeys.md part C): the local model explores through ui.mjs, one JSON
// action per turn. Everything it can touch arrives as a port, so the tests need no GPU and no browser:
//   model.chat(messages, {json, maxTokens}) -> {text, ms, usage:{input, output}}
//   ui(cmd, args, flags)                    -> {ok, text, data?, error?}
//   readActions()                           -> the parsed lines of the ui.mjs action log
//   readShot(path)                          -> Buffer | null
//   now()                                   -> ms
// steps.json comes from the ACTION LOG, never from what the model says it did.
import { parseJson } from '../../local-model.mjs';
import { imageTokens } from '../../e2e-triage/lib.mjs';
import { validateExpect } from '../codegen.mjs';
import { COMMANDS } from '../commands.mjs';

export const BUDGET = { calls: 40, ms: 15 * 60_000 };
export const SEVERITIES = ['high', 'medium', 'low'];
/** What the model may answer in `finish`; `blocked` becomes `blocked-at <step>`. */
export const MODEL_VERDICTS = ['passes', 'blocked', 'docs-mismatch', 'ux-issue', 'a11y'];
/** ui.mjs commands the explorer may call. The runner owns seed, open, stop and help. */
export const MODEL_TOOLS = COMMANDS.filter((c) => !['seed', 'open', 'stop', 'help'].includes(c.name));
const OBS_CAP = 6000;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[... ${s.length - n} chars cut]` : s);

export function systemPrompt(def, docsText) {
  return [
    `You explore a web app through a browser to check one short user journey. Role: ${def.role}. Viewport ${def.viewport.width}x${def.viewport.height}.`,
    `Journey: ${def.goal}`,
    `At most ${def.maxActions} actions. The app is already open and signed in.`,
    '',
    'Tools (one per turn):',
    ...MODEL_TOOLS.map((c) => `  ${c.usage}: ${c.summary}`),
    'Refs (e1, e2, ...) come from the last snapshot and are valid until the next snapshot: snapshot again after the page changes.',
    'Take a screenshot when a screen changes and for anything visual: maps, contrast, layout, touch targets of 56 px or more.',
    '',
    'Reply with ONE JSON object per turn:',
    '{"action":"snapshot|click|fill|select|press|wait|screenshot|console|network|axe","args":["e3"],"expect":{...},"note":"why"}',
    '"expect" is optional: what must be true AFTER this action, one of',
    '  {"role":"heading","name":"Tree","visible":true}   {"role":"listitem","name":"Row","count":3}',
    '  {"role":"status","name":"Saved","text":"Saved"}    {"text":"some text on the page"}   {"url":"/path"}',
    'Use the exact role and accessible name from the snapshot. Only state expectations you have seen to be true.',
    'When the journey is done or you cannot go on, reply:',
    `{"action":"finish","verdict":"${MODEL_VERDICTS.join('|')}","findings":[{"severity":"high|medium|low","text":"what, with the snapshot line"}]}`,
    'Verdict docs-mismatch: the app differs from the user doc. ux-issue: confusing or too many steps. a11y: accessibility problem.',
    '',
    'User doc (what the app should do):',
    docsText,
  ].join('\n');
}

function validFindings(list) {
  return (Array.isArray(list) ? list : []).flatMap((f) =>
    f && SEVERITIES.includes(f.severity) && typeof f.text === 'string' && f.text
      ? [{ severity: f.severity, text: f.text }]
      : [],
  );
}

/** Replaces the body of older snapshots and screenshots (all but the newest of each) so the context stays small. */
function elideOld(messages) {
  for (const kind of ['snapshot', 'shot'])
    for (const m of messages.filter((x) => x.kind === kind).slice(0, -1))
      m.content = `[earlier ${kind} elided]`;
}

/**
 * Runs one journey. Never throws because of the model: a model that fails ends the journey as blocked-at.
 * @returns {Promise<{verdict:string, findings:object[], steps:object[], expectations:object[], notes:string[], shots:string[], stats:object}>}
 */
export async function runJourney({
  def,
  docsText = '',
  model,
  ui,
  readActions,
  readShot,
  now,
  budget = BUDGET,
}) {
  const stats = { calls: 0, in: 0, out: 0, image: 0, ms: 0, screenshots: 0, rejected: 0 };
  const shots = [];
  const notes = [];
  const expectations = [];
  const t0 = now();

  const seeded = await ui('seed', [def.fixture], {});
  if (!seeded.ok) throw new Error(`seed failed: ${seeded.error}`);
  const opened = await ui('open', [`${seeded.data.url}${def.startPath}`], {
    viewport: `${def.viewport.width}x${def.viewport.height}`,
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
  const first = await ui('snapshot', [], {});

  const messages = [
    { role: 'system', content: systemPrompt(def, docsText) },
    { role: 'user', kind: 'snapshot', content: clip(first.text, OBS_CAP) },
  ];
  const logCount = () => readActions().length;
  const blockedAt = (why) => {
    notes.push(why);
    return `blocked-at ${logCount() + 1}`;
  };
  let verdict;
  let findings = [];
  let actions = 0;

  while (verdict === undefined) {
    if (stats.calls >= budget.calls) verdict = blockedAt(`budget: ${budget.calls} model calls used`);
    else if (now() - t0 >= budget.ms)
      verdict = blockedAt(`budget: ${Math.round(budget.ms / 60_000)} minutes used`);
    else if (actions >= def.maxActions) verdict = blockedAt(`budget: ${def.maxActions} actions used`);
    if (verdict !== undefined) break;

    let reply;
    try {
      reply = await model.chat(
        messages.map(({ role, content }) => ({ role, content })),
        {
          json: true,
          maxTokens: 700,
        },
      );
    } catch (e) {
      verdict = blockedAt(`model unavailable: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    stats.calls++;
    stats.in += reply.usage.input;
    stats.out += reply.usage.output;
    stats.ms += reply.ms;
    const msg = parseJson(reply.text);
    messages.push({ role: 'assistant', content: reply.text });
    if (msg === null || typeof msg.action !== 'string') {
      stats.rejected++;
      messages.push({
        role: 'user',
        content: 'That was not one JSON object with an "action". Reply with exactly one.',
      });
      continue;
    }
    if (msg.action === 'finish') {
      const v = MODEL_VERDICTS.includes(msg.verdict) ? msg.verdict : undefined;
      if (v === undefined) {
        stats.rejected++;
        messages.push({ role: 'user', content: `verdict must be one of ${MODEL_VERDICTS.join(', ')}.` });
        continue;
      }
      findings = validFindings(msg.findings);
      verdict = v === 'blocked' ? blockedAt('the explorer reported it was blocked') : v;
      break;
    }
    const tool = MODEL_TOOLS.find((c) => c.name === msg.action);
    if (tool === undefined) {
      stats.rejected++;
      messages.push({
        role: 'user',
        content: `Unknown action "${msg.action}". Tools: ${MODEL_TOOLS.map((c) => c.name).join(', ')}.`,
      });
      continue;
    }
    const args = (Array.isArray(msg.args) ? msg.args : msg.args === undefined ? [] : [msg.args]).map(String);
    const res = await ui(tool.name, args, {});
    actions++;
    if (!res.ok) {
      messages.push({ role: 'user', content: `error: ${res.error}` });
      continue;
    }
    if (msg.expect !== undefined) {
      const list = Array.isArray(msg.expect) ? msg.expect : [msg.expect];
      for (const x of list) {
        const e = validateExpect(x);
        const after = logCount();
        const dup = expectations.some(
          (y) => y.after === after && JSON.stringify(y.expect) === JSON.stringify(e),
        );
        if (e && !dup) expectations.push({ after, expect: e });
        else notes.push(`ignored expectation: ${JSON.stringify(x)}`);
      }
    }
    const obs = {
      role: 'user',
      kind: tool.name === 'snapshot' ? 'snapshot' : 'obs',
      content: clip(res.text, OBS_CAP),
    };
    const image = tool.name === 'screenshot' ? readShot(res.data?.path) : null;
    if (tool.name === 'screenshot') {
      stats.screenshots++;
      shots.push(res.data?.path);
    }
    if (image) {
      stats.image += imageTokens(image);
      obs.kind = 'shot';
      obs.content = [
        { type: 'text', text: 'screenshot taken' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } },
      ];
    }
    messages.push(obs);
    elideOld(messages);
  }

  const steps = readActions().map((a, i) => ({
    n: i + 1,
    cmd: a.cmd,
    locator: a.locator,
    args: a.args,
    url: a.url,
  }));
  return {
    verdict,
    findings,
    steps,
    expectations,
    notes,
    shots,
    stats: { ...stats, ms: stats.ms, wallMs: now() - t0, actions: steps.length },
  };
}
