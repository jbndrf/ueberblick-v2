// The measure tool (WP-552): a `toolbar` tool that only reads. It places points, shows one temporary overlay
// on the map and prints the length or area core.geo derives. It never writes a value (R3).
import type { Geo, Position } from '@ueberblick/core/geo';
import { defineTool, type PanelTool, type PanelToolContext, type ToolHandle } from '@ueberblick/ui/tool-api';
import { issueText, message, type MeasureMessageKey } from './messages';
import {
  formatArea,
  formatLength,
  MEASURE_MODES,
  measure,
  MIN_POINTS,
  overlayOf,
  type MeasureMode,
} from './model';

const STYLE = `
.ub-measure{display:flex;flex-direction:column;gap:var(--ub-space-sm,8px)}
.ub-measure-row{display:flex;flex-wrap:wrap;gap:var(--ub-space-sm,8px)}
.ub-measure-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-height:56px;min-width:56px;padding:0 var(--ub-space-md,16px);font:inherit;font-weight:var(--ub-type-weight-strong,600);color:var(--ub-color-text,#111);background:var(--ub-color-bg,#fff);border:2px solid var(--ub-color-border,#767676);border-radius:var(--ub-radius-md,8px);cursor:pointer}
.ub-measure-btn:focus-visible{outline:3px solid var(--ub-color-focus,#005fcc);outline-offset:2px}
.ub-measure-btn:disabled{opacity:.6;cursor:default}
.ub-measure-btn[aria-pressed=true]{background:var(--ub-color-text,#111);color:var(--ub-color-bg,#fff)}
.ub-measure-out{margin:0;font-size:var(--ub-type-size-lg,20px);font-weight:var(--ub-type-weight-strong,600);color:var(--ub-color-text,#111)}
.ub-measure-note{margin:0;font-size:var(--ub-type-size-sm,14px);color:var(--ub-color-text-muted,#555)}
.ub-measure-note[data-error]{color:var(--ub-color-danger,#b00020);font-weight:var(--ub-type-weight-strong,600)}
`;

function button(cls: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ub-measure-btn ${cls}`;
  b.textContent = text;
  return b;
}

function mountMeasure(root: HTMLElement, ctx: PanelToolContext, deps: { geo: Geo }): ToolHandle {
  const t = (k: MeasureMessageKey, v?: Record<string, string | number>) => message(ctx.locale, k, v);
  let mode: MeasureMode = 'distance';
  let points: readonly Position[] = [];
  let locating = false;
  let failed = false;
  let destroyed = false;

  const wrap = document.createElement('div');
  wrap.className = 'ub-measure';
  const style = document.createElement('style');
  style.textContent = STYLE;
  const modes = document.createElement('div');
  modes.className = 'ub-measure-row';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', t('modeGroup'));
  const modeButtons = new Map<MeasureMode, HTMLButtonElement>();
  for (const m of Object.keys(MEASURE_MODES) as MeasureMode[]) {
    const b = button('ub-measure-mode', t(m));
    b.addEventListener('click', () => {
      mode = m;
      render();
    });
    modeButtons.set(m, b);
    modes.append(b);
  }
  const out = document.createElement('p');
  out.className = 'ub-measure-out';
  out.setAttribute('role', 'status');
  out.setAttribute('aria-live', 'polite');
  const detail = document.createElement('p');
  detail.className = 'ub-measure-note';
  const note = document.createElement('p');
  note.className = 'ub-measure-note';
  note.setAttribute('role', 'status');
  const row = document.createElement('div');
  row.className = 'ub-measure-row';
  const locateBtn = button('ub-measure-locate', t('usePosition'));
  const undoBtn = button('ub-measure-undo', t('undo'));
  const clearBtn = button('ub-measure-clear', t('clear'));
  row.append(locateBtn, undoBtn, clearBtn);

  function explain(): string {
    if (locating) return t('locating');
    if (failed) return t('locateFailed');
    if (points.length === 0) return t('hint');
    return t('needMore', { n: MIN_POINTS[mode] - points.length });
  }

  function render(): void {
    for (const [m, b] of modeButtons) b.setAttribute('aria-pressed', String(m === mode));
    undoBtn.disabled = points.length === 0;
    clearBtn.disabled = points.length === 0;
    locateBtn.disabled = locating;
    out.textContent = '';
    detail.textContent = '';
    note.textContent = '';
    note.toggleAttribute('data-error', false);
    const result = measure(deps.geo, mode, points);
    if (result.state === 'refused') {
      const first = result.issues[0];
      note.textContent = t('refused', { reason: first ? issueText(ctx.locale, first.issue) : '' });
      note.toggleAttribute('data-error', true);
    } else if (result.state === 'ok' && result.mode === 'distance') {
      out.textContent = t('total', { value: formatLength(ctx.locale, result.lengthM) });
      detail.textContent = t('lastLeg', { value: formatLength(ctx.locale, result.lastLegM) });
    } else if (result.state === 'ok') {
      out.textContent = t('areaOf', { value: formatArea(ctx.locale, result.areaM2) });
      detail.textContent = t('perimeter', { value: formatLength(ctx.locale, result.perimeterM) });
    } else {
      note.textContent = explain();
      note.toggleAttribute('data-error', failed);
    }
    const overlay = overlayOf(mode, points);
    if (overlay) ctx.map.showOverlay(overlay);
    else ctx.map.clearOverlay();
  }

  const add = (p: Position): void => {
    failed = false;
    points = [...points, p];
    render();
  };
  locateBtn.addEventListener('click', () => {
    locating = true;
    failed = false;
    render();
    void ctx.ports.position
      .current()
      .then((fix) => {
        if (destroyed) return;
        locating = false;
        add([fix.lon, fix.lat]);
      })
      .catch(() => {
        if (destroyed) return;
        locating = false;
        failed = true;
        render();
      });
  });
  undoBtn.addEventListener('click', () => {
    points = points.slice(0, -1);
    render();
  });
  clearBtn.addEventListener('click', () => {
    points = [];
    render();
  });

  const untap = ctx.map.onTap(add);
  render();
  wrap.append(style, modes, out, detail, note, row);
  root.append(wrap);
  return {
    destroy() {
      destroyed = true;
      untap();
      ctx.map.clearOverlay();
      wrap.remove();
    },
  };
}

export function createMeasureTool(deps: { readonly geo: Geo }): PanelTool {
  return defineTool({
    key: 'measure',
    contributes: ['tools-sheet'],
    mount: (root, ctx) => mountMeasure(root, ctx, deps),
  });
}
