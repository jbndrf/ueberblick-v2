import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** The update script is the inline block of app.html between the markers: the real text runs here against fakes. */
const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const script =
  /<!-- update:start -->\s*<script[^>]*>([\s\S]*?)<\/script>\s*<!-- update:end -->/.exec(html)?.[1] ?? '';

function setup(opts: { controller: boolean; form: boolean }) {
  const listeners: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const state = { reloads: 0, form: opts.form };
  const sandbox = {
    navigator: {
      serviceWorker: {
        controller: opts.controller ? {} : null,
        addEventListener: (_: string, f: () => void) => listeners.push(f),
      },
    },
    document: { querySelector: (s: string) => (s === 'form' && state.form ? {} : null) },
    location: { reload: () => (state.reloads += 1) },
    setTimeout: (f: () => void) => timers.push(f),
  };
  runInNewContext(script, sandbox);
  return {
    state,
    fire: () => listeners.forEach((f) => f()),
    tick: () => timers.splice(0).forEach((f) => f()),
  };
}

describe('update script in app.html', () => {
  it('exists', () => expect(script.length).toBeGreaterThan(20));

  it('reloads into the new build when a new worker takes over and no form is open', () => {
    const t = setup({ controller: true, form: false });
    t.fire();
    expect(t.state.reloads).toBe(1);
  });

  it('waits while a form is open and reloads once it is closed', () => {
    const t = setup({ controller: true, form: true });
    t.fire();
    expect(t.state.reloads).toBe(0);
    t.tick();
    expect(t.state.reloads).toBe(0);
    t.state.form = false;
    t.tick();
    expect(t.state.reloads).toBe(1);
  });

  it('does not reload on the first install (no previous worker)', () => {
    const t = setup({ controller: false, form: false });
    t.fire();
    expect(t.state.reloads).toBe(0);
    t.fire(); // a later build while the page stays open does update
    expect(t.state.reloads).toBe(1);
  });
});
