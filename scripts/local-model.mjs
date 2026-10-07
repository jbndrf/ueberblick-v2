// Client for the local model (Qwen on the owner's GPU fleet): used by docsync (docs) and logwatch
// (logs, server health). The local model never reviews code. Config from env, else from
// ~/.omp/agent/models.yml. Never print the api key or the /running response (it holds secrets).
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_MODEL = 'qwen3.8-27b-nvfp4-kv8-c128k-n4-mtp';

export function config() {
  let baseUrl = process.env.LOCAL_MODEL_BASE_URL;
  let apiKey = process.env.LOCAL_MODEL_API_KEY;
  const omp = join(homedir(), '.omp/agent/models.yml');
  if ((!baseUrl || !apiKey) && existsSync(omp)) {
    const y = readFileSync(omp, 'utf8');
    const block =
      y.split(/\n\s{2}(?=\S)/).find((b) => b.startsWith('vllm-local') || b.includes('vllm-local:')) ?? y;
    baseUrl ??= block.match(/baseUrl:\s*(\S+)/)?.[1];
    apiKey ??= block.match(/apiKey:\s*["']?([^"'\s]+)/)?.[1];
  }
  if (!baseUrl)
    throw new Error('local model: set LOCAL_MODEL_BASE_URL (or vllm-local in ~/.omp/agent/models.yml)');
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  return { root, apiKey: apiKey ?? '', model: process.env.LOCAL_MODEL ?? DEFAULT_MODEL };
}

/**
 * One chat completion. Thinking is off by default: extraction and summaries are correct and ~10x
 * faster without it (lab). NInfer rejects response_format, so JSON is requested in the prompt.
 * Returns { text, ms, usage: { input, output }, model }.
 */
export async function chat(messages, { json = false, maxTokens = 4000, thinking = false } = {}) {
  const c = config();
  if (json)
    messages = [
      ...messages,
      { role: 'user', content: 'Reply with the JSON object only, no prose, no code fence.' },
    ];
  const t0 = Date.now();
  const res = await fetch(`${c.root}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({
      model: c.model,
      messages,
      max_tokens: thinking ? maxTokens + 12000 : maxTokens,
      temperature: 0.2,
      chat_template_kwargs: { enable_thinking: thinking },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) throw new Error(`local model: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    ms: Date.now() - t0,
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
    model: c.model,
  };
}

export function parseJson(text) {
  for (const c of [
    text,
    text.replace(/^```(?:json)?\s*|\s*```$/g, ''),
    text.match(/\{[\s\S]*\}/)?.[0] ?? '',
  ]) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

/**
 * Good-citizen check for the shared GPU (llama-swap serves ONE model at a time; a swap costs ~20 s
 * and stalls other users). True if our model is loaded or nothing is.
 */
export async function gpuFree() {
  const c = config();
  try {
    const res = await fetch(`${c.root}/running`, {
      headers: { Authorization: `Bearer ${c.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return true;
    const running = (await res.json()).running ?? [];
    return running.length === 0 || running.some((r) => r.model === c.model);
  } catch {
    return true;
  }
}
