// The trimmed accessibility snapshot: interactive and landmark nodes with stable refs (e1, e2, ...).
// collect() runs inside the page. It stamps every listed element with data-ui-ref so an action can find
// it again, and it never reports CSS: only role, accessible name and data-testid leave the page.

/** About 4k tokens (4 characters each). */
export const SNAPSHOT_CAP_CHARS = 16_000;

/** Runs in the page; must stay self-contained. */
export function collect() {
  const INPUT_ROLES = {
    '': 'textbox',
    text: 'textbox',
    email: 'textbox',
    tel: 'textbox',
    url: 'textbox',
    search: 'searchbox',
    number: 'spinbutton',
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    button: 'button',
    submit: 'button',
    reset: 'button',
    image: 'button',
  };
  const TAG_ROLES = {
    button: 'button',
    textarea: 'textbox',
    nav: 'navigation',
    main: 'main',
    aside: 'complementary',
    dialog: 'dialog',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
  };
  const FORM_TAGS = ['input', 'textarea', 'select', 'button', 'a'];
  const text = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  for (const old of document.querySelectorAll('[data-ui-ref]')) old.removeAttribute('data-ui-ref');

  const nameOf = (el, tag) => {
    const label = el.getAttribute('aria-label');
    if (label) return text(label);
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');
      if (text(t)) return text(t);
    }
    if (el.labels && el.labels.length > 0) return text([...el.labels].map((l) => l.textContent).join(' '));
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type)) return text(el.value);
    if (tag === 'img' || (tag === 'input' && el.type === 'image')) return text(el.getAttribute('alt'));
    if (['input', 'textarea', 'select'].includes(tag))
      return text(el.getAttribute('title') ?? el.getAttribute('placeholder'));
    return text(el.textContent) || text(el.getAttribute('title'));
  };

  const roleOf = (el, tag) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'input') return el.type === 'password' ? null : (INPUT_ROLES[el.type] ?? 'textbox');
    if (tag === 'select') return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'header' || tag === 'footer') {
      if (el.closest('article,aside,main,nav,section')) return null;
      return tag === 'header' ? 'banner' : 'contentinfo';
    }
    if (tag === 'form' || tag === 'section') {
      if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) return null;
      return tag === 'form' ? 'form' : 'region';
    }
    return TAG_ROLES[tag] ?? null;
  };

  const out = [];
  const add = (el, node) => {
    el.setAttribute('data-ui-ref', `e${out.length + 1}`);
    out.push(node);
  };
  for (const el of document.body.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const testid = el.getAttribute('data-testid');
    if (tag === 'canvas') {
      if (el.checkVisibility()) add(el, { role: 'canvas', name: '', testid, tag, state: [] });
      continue;
    }
    const role = roleOf(el, tag);
    const password = tag === 'input' && el.type === 'password';
    if (role === null && !password && !(testid && FORM_TAGS.includes(tag))) continue;
    if (!el.checkVisibility({ checkVisibilityCSS: true }) || el.closest('[aria-hidden="true"]')) continue;
    const state = [];
    if (el.disabled) state.push('disabled');
    if (el.checked) state.push('checked');
    if (el.getAttribute('aria-expanded')) state.push(`expanded=${el.getAttribute('aria-expanded')}`);
    if (tag === 'input' && !password && el.value && !['checkbox', 'radio'].includes(el.type))
      state.push(`value="${text(el.value).slice(0, 60)}"`);
    if (tag === 'select') state.push(`value="${text(el.selectedOptions[0]?.textContent)}"`);
    add(el, {
      role: role ?? (password ? 'password' : tag),
      aria: role !== null,
      name: nameOf(el, tag).slice(0, 80),
      testid,
      tag,
      state,
    });
  }
  return out;
}

export function formatNode(n, i) {
  const bits = [`- ${n.role}${n.name ? ` "${n.name}"` : ''} [e${i + 1}]`];
  if (n.testid) bits.push(`testid=${n.testid}`);
  bits.push(...n.state);
  return bits.join(' ');
}

/** Lines up to the cap, plus an explicit marker when it cut (never silent). */
export function render(nodes, cap = SNAPSHOT_CAP_CHARS) {
  const lines = [];
  let size = 0;
  for (let i = 0; i < nodes.length; i++) {
    const line = formatNode(nodes[i], i);
    if (size + line.length + 1 > cap) {
      lines.push(
        `[truncated: ${i} of ${nodes.length} nodes shown (cap ${cap} characters); refs e${i + 1}..e${nodes.length} exist but are not listed]`,
      );
      return { text: lines.join('\n'), truncated: true };
    }
    lines.push(line);
    size += line.length + 1;
  }
  return { text: lines.join('\n') || '(no interactive or landmark nodes)', truncated: false };
}
