// e2e triage core (docs/process/e2e-triage.md): evidence from a Playwright JSON report, one local-model
// classification per failing test, report + metrics + ATTENTION. Ports (model, trace and image readers,
// directory, clock) are injected, so the tests need no GPU, browser or zip.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJson } from '../local-model.mjs';
import { append, attention } from '../metrics/lib.mjs';

export const CLASSES = ['app-bug', 'test-bug', 'flaky', 'env'];
export const CONFIDENCES = ['high', 'medium', 'low'];
export const UNKNOWN = 'unknown';
export const MAX_PROMPT_CHARS = 20_000;
const FIELD_CAPS = { error: 3000, console: 2000, network: 2000, trace: 8000, dom: 4000 };

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n[... ${s.length - n} chars cut]` : s);
const tail = (s, n) => (s.length > n ? `[${s.length - n} chars cut ...]\n${s.slice(-n)}` : s);
const strip = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

function* walkSpecs(suites) {
  for (const s of suites ?? []) {
    for (const spec of s.specs ?? []) yield spec;
    yield* walkSpecs(s.suites);
  }
}

const BAD = new Set(['failed', 'timedOut', 'interrupted']);

/** One record per failing test (its last attempt): spec, title, failing step, error, console, attachments. */
export function collectFailures(report) {
  const out = [];
  for (const spec of walkSpecs(report.suites)) {
    for (const t of spec.tests ?? []) {
      const r = t.results?.at(-1);
      if (!r || !BAD.has(r.status)) continue;
      const steps = (r.steps ?? []).filter((s) => s.error);
      out.push({
        spec: `${spec.file}:${spec.line}`,
        title: spec.title,
        status: r.status,
        failingStep: steps.at(-1)?.title ?? '(none)',
        error: strip(r.error?.message ?? (r.errors ?? []).map((e) => e.message).join('\n')),
        console: [...(r.stderr ?? []), ...(r.stdout ?? [])].map((x) => strip(x.text ?? x)).join(''),
        network: '',
        trace: '',
        attachments: r.attachments ?? [],
      });
    }
  }
  return out;
}

const parseLines = (t) =>
  t.split('\n').flatMap((l) => {
    try {
      return l ? [JSON.parse(l)] : [];
    } catch {
      return [];
    }
  });

/** Failed requests ("status url") from a trace's network file. */
export function failedRequests(networkText) {
  return parseLines(networkText ?? '').flatMap((e) => {
    const r = e.snapshot;
    return r && (r.response?.status >= 400 || r.response?.status < 0)
      ? [`${r.response.status} ${r.request?.url}`]
      : [];
  });
}

/** Text summary of a Playwright trace: actions, console errors, failed requests, last DOM snapshot. Trimmed. */
export function traceSummary(traceText, networkText) {
  const events = parseLines(traceText);
  const actions = [];
  const errors = [];
  let dom = '';
  for (const e of events) {
    if (e.type === 'before')
      actions.push(
        `${e.apiName ?? e.method}${e.params?.url ? ` ${e.params.url}` : e.params?.selector ? ` ${e.params.selector}` : ''}`,
      );
    else if (e.type === 'console' && /error|warning/.test(e.messageType ?? ''))
      errors.push(`console ${e.messageType}: ${e.text}`);
    else if (e.type === 'frame-snapshot') dom = JSON.stringify(e.snapshot?.html ?? '');
  }
  const failed = failedRequests(networkText);
  return clip(
    [
      `actions (last 40 of ${actions.length}):`,
      ...actions.slice(-40),
      'console errors:',
      ...errors.slice(-20),
      'failed requests:',
      ...failed.slice(-20),
      `last DOM snapshot: ${tail(dom, FIELD_CAPS.dom)}`,
    ].join('\n'),
    FIELD_CAPS.trace,
  );
}

const SYSTEM = `You triage one failing end-to-end test of a web app (Playwright). Classify it:
app-bug (the product is wrong), test-bug (the test is wrong or outdated), flaky (timing, passes on retry), env (server, browser, network or machine problem).
Reply JSON only: {"class":"app-bug|test-bug|flaky|env","confidence":"high|medium|low","evidence":"one or two sentences quoting the error","next":"one concrete next step"}`;

/** Chat messages for one failure. The text is capped at MAX_PROMPT_CHARS; the screenshot is an image part. */
export function buildPrompt(f, image = null) {
  const text = clip(
    [
      `spec: ${f.spec}`,
      `title: ${f.title}`,
      `status: ${f.status}`,
      `failing step: ${f.failingStep}`,
      `error:\n${clip(f.error, FIELD_CAPS.error)}`,
      `console:\n${tail(f.console, FIELD_CAPS.console)}`,
      `network errors:\n${tail(f.network, FIELD_CAPS.network)}`,
      `trace:\n${clip(f.trace, FIELD_CAPS.trace)}`,
    ].join('\n\n'),
    MAX_PROMPT_CHARS,
  );
  const content = image
    ? [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } },
      ]
    : text;
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content },
  ];
}

/** Qwen-VL style estimate: one token per 28x28 patch, from the PNG header. */
export function imageTokens(png) {
  if (!png || png.length < 24) return 0;
  return Math.ceil(png.readUInt32BE(16) / 28) * Math.ceil(png.readUInt32BE(20) / 28);
}

function validate(v) {
  if (!v || !CLASSES.includes(v.class) || !CONFIDENCES.includes(v.confidence)) return null;
  return {
    class: v.class,
    confidence: v.confidence,
    evidence: String(v.evidence ?? ''),
    next: String(v.next ?? ''),
  };
}

/** Polls `model.gpuFree()` until it is true or `waitMs` has passed. Shared by triage and `npm run journeys`. */
export async function waitForGpu(model, waitMs, intervalMs = 5000) {
  const until = Date.now() + waitMs;
  for (;;) {
    if (await model.gpuFree()) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, Math.max(0, until - Date.now()))));
  }
}

async function classify(model, f, image, totals) {
  let reason = 'model gave no valid JSON twice';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await model.chat(buildPrompt(f, image), { json: true, maxTokens: 600 });
      totals.in += r.usage.input;
      totals.out += r.usage.output;
      totals.ms += r.ms;
      if (image && attempt === 0) totals.image += imageTokens(image);
      const v = validate(parseJson(r.text));
      if (v) return v;
    } catch (e) {
      reason = `local model unavailable: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
  }
  return { class: UNKNOWN, confidence: 'low', evidence: reason, next: 'read the trace by hand' };
}

function readZipEntry(zip, pattern) {
  try {
    return execFileSync('unzip', ['-p', zip, pattern], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

/** Default trace reader: the `trace` attachment's zip, via `unzip -p`. */
export function readTraceFromZip(f) {
  const zip = f.attachments.find((a) => a.name === 'trace')?.path;
  if (!zip || !existsSync(zip)) return null;
  return { trace: readZipEntry(zip, '*trace.trace'), network: readZipEntry(zip, '*trace.network') };
}

/** Default screenshot reader: the last PNG attachment. */
export function readLastScreenshot(f) {
  const p = f.attachments.filter((a) => a.contentType === 'image/png' && a.path).at(-1)?.path;
  return p && existsSync(p) ? readFileSync(p) : null;
}

export function reportMarkdown(stamp, rows, totals) {
  const suites = [...new Set(rows.map(({ f }) => f.suite))];
  return [
    `# e2e triage ${stamp}`,
    `${rows.length} failing tests · local model ${totals.ms} ms, tokens in ${totals.in} / out ${totals.out} / image ${totals.image}`,
    '',
    ...suites.flatMap((suite) => {
      const mine = rows.filter(({ f }) => f.suite === suite);
      return [
        `# ${suite} (${mine.length})`,
        '',
        ...mine.flatMap(({ f, v }) => [
          `## ${f.spec}: ${f.title}`,
          `- class: **${v.class}** (confidence ${v.confidence})`,
          `- failing step: ${f.failingStep}`,
          `- evidence: ${v.evidence}`,
          `- next: ${v.next}`,
          '',
          '```',
          clip(f.error, 1500),
          '```',
          '',
        ]),
      ];
    }),
  ].join('\n');
}

/** The finding for a suite whose JSON report does not exist: an environment problem, no model needed. */
export function missingReportFinding(suite) {
  const f = {
    suite,
    spec: suite,
    title: 'report missing',
    status: 'failed',
    failingStep: '(none)',
    error: `No Playwright JSON report for suite ${suite}: the suite did not run or crashed before writing it.`,
    console: '',
    network: '',
    trace: '',
    attachments: [],
  };
  const v = {
    class: 'env',
    confidence: 'high',
    evidence: f.error,
    next: 'run `npm run e2e` and read its output for this suite',
  };
  return { f, v };
}

/**
 * Triage the Playwright JSON reports of the suites (`report` null = missing). Never throws because of the
 * model: failures become class `unknown`.
 * @returns {{ byClass: Record<string, number>, bySuite: Record<string, number>, tokens: {in:number,out:number,image:number}, file: string }}
 */
export async function runTriage({
  reports,
  model,
  dir,
  now = new Date(),
  waitMs = 120_000,
  readTrace = readTraceFromZip,
  readImage = readLastScreenshot,
}) {
  const failures = reports.flatMap(({ suite, report }) =>
    report ? collectFailures(report).map((f) => ({ ...f, suite })) : [],
  );
  const missing = reports.filter((r) => !r.report).map((r) => missingReportFinding(r.suite));
  const totals = { in: 0, out: 0, image: 0, ms: 0 };
  const free = failures.length ? await waitForGpu(model, waitMs) : true;
  const rows = [];
  for (const f of failures) {
    const t = readTrace(f);
    if (t) {
      f.trace = traceSummary(t.trace, t.network);
      f.network = failedRequests(t.network).join('\n');
    }
    const image = readImage(f);
    const v = free
      ? await classify(model, f, image, totals)
      : { class: UNKNOWN, confidence: 'low', evidence: 'GPU busy with another model', next: 'rerun later' };
    rows.push({ f, v });
  }
  rows.push(...missing);
  const order = reports.map((r) => r.suite);
  rows.sort((a, b) => order.indexOf(a.f.suite) - order.indexOf(b.f.suite));
  const byClass = {};
  const bySuite = {};
  for (const { f, v } of rows) {
    byClass[v.class] = (byClass[v.class] ?? 0) + 1;
    bySuite[f.suite] = (bySuite[f.suite] ?? 0) + 1;
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
  mkdirSync(join(dir, 'e2e'), { recursive: true });
  const file = join(dir, 'e2e', `${stamp}.md`);
  writeFileSync(file, reportMarkdown(stamp, rows, totals));
  const hot = rows.filter(({ v }) => v.class === 'app-bug' && v.confidence === 'high');
  if (hot.length)
    attention(
      'e2e app-bug',
      [
        ...hot.map(({ f, v }) => `${f.spec}: ${f.title}: ${v.evidence} → ${v.next}`),
        `details: metrics/raw/e2e/${stamp}.md`,
      ],
      dir,
      now,
    );
  append(
    'e2e.jsonl',
    {
      failures: rows.length,
      byClass,
      bySuite,
      tokens: { in: totals.in, out: totals.out, image: totals.image },
      ms: totals.ms,
    },
    dir,
  );
  return { byClass, bySuite, tokens: { in: totals.in, out: totals.out, image: totals.image }, file };
}
