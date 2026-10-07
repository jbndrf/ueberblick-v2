// The install state of the app (v3 `pwa-detection.svelte.ts`): installed or in the browser, the install prompt the
// browser offers once, and the service worker's status for the card's technical details. A port-based store, so the
// map screen starts it at once (the browser fires `beforeinstallprompt` early, before the lazy sheet exists).
import type { Readable } from '@ueberblick/client';

export interface InstallPromptEvent {
  preventDefault(): void;
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

/** The platform events the state follows. `displaymode` fires when the app is installed while open. */
export const PWA_EVENTS = ['beforeinstallprompt', 'appinstalled', 'displaymode'] as const;
export type PwaEventType = (typeof PWA_EVENTS)[number];

export interface PwaEnv {
  /** display-mode standalone, iOS `navigator.standalone`, or a TWA. */
  standalone(): boolean;
  /** iPhone/iPad Safari: no install prompt, the person adds the app by hand (`isIos`). */
  ios(): boolean;
  on(type: PwaEventType, listener: (event: unknown) => void): () => void;
  /** Absent in a browser without service workers. */
  readonly serviceWorker:
    { getRegistration(): Promise<unknown>; readonly ready: Promise<unknown> } | undefined;
}

export interface PwaState {
  readonly mode: 'browser' | 'pwa';
  readonly canInstall: boolean;
  readonly ios: boolean;
  readonly swStatus: 'checking' | 'registered' | 'error' | 'unsupported';
  readonly swError: string | undefined;
}

export interface Pwa extends Readable<PwaState> {
  /** Shows the browser's install prompt; true when the person accepted. It works once per prompt. */
  install(): Promise<boolean>;
  stop(): void;
}

/** iPhone, iPad, or iPadOS in its desktop mode (reports a Mac, but has a touch screen). */
export function isIos(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === 'MacIntel' && maxTouchPoints > 1;
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createPwa(env: PwaEnv): Pwa {
  let prompt: InstallPromptEvent | undefined;
  let state: PwaState = {
    mode: env.standalone() ? 'pwa' : 'browser',
    canInstall: false,
    ios: env.ios(),
    swStatus: env.serviceWorker === undefined ? 'unsupported' : 'checking',
    swError: undefined,
  };
  const listeners = new Set<(s: PwaState) => void>();
  const set = (patch: Partial<PwaState>): void => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };

  const stops = [
    env.on('beforeinstallprompt', (e) => {
      (e as InstallPromptEvent).preventDefault(); // no browser mini-infobar: the card has the button
      prompt = e as InstallPromptEvent;
      set({ canInstall: true });
    }),
    env.on('appinstalled', () => {
      prompt = undefined;
      set({ mode: 'pwa', canInstall: false });
    }),
    env.on('displaymode', () => {
      const installed = env.standalone();
      set(installed ? { mode: 'pwa', canInstall: false } : { mode: 'browser' });
    }),
  ];

  const sw = env.serviceWorker;
  if (sw !== undefined) {
    const fail = (e: unknown): void => set({ swStatus: 'error', swError: errorText(e) });
    sw.getRegistration().then((reg) => {
      if (reg !== undefined) set({ swStatus: 'registered' });
    }, fail);
    sw.ready.then(() => set({ swStatus: 'registered' }), fail);
  }

  return {
    get: () => state,
    subscribe(run) {
      listeners.add(run);
      run(state);
      return () => void listeners.delete(run);
    },
    async install() {
      const asked = prompt;
      if (asked === undefined) return false;
      await asked.prompt();
      const { outcome } = await asked.userChoice;
      prompt = undefined; // a prompt can be used once
      if (outcome !== 'accepted') {
        set({ canInstall: false });
        return false;
      }
      set({ mode: 'pwa', canInstall: false });
      return true;
    },
    stop() {
      for (const s of stops) s();
      listeners.clear();
    },
  };
}

/** The real platform. A Safari without the install event still reports `standalone` and the service worker. */
export function browserPwaEnv(win: Window, nav: Navigator): PwaEnv {
  const media = win.matchMedia?.('(display-mode: standalone)');
  return {
    standalone: () =>
      media?.matches === true ||
      (nav as Navigator & { standalone?: boolean }).standalone === true ||
      win.document.referrer.includes('android-app://'),
    ios: () => isIos(nav.userAgent, nav.platform, nav.maxTouchPoints),
    on(type, listener) {
      if (type === 'displaymode') {
        media?.addEventListener('change', listener);
        return () => media?.removeEventListener('change', listener);
      }
      win.addEventListener(type, listener);
      return () => win.removeEventListener(type, listener);
    },
    serviceWorker: 'serviceWorker' in nav ? nav.serviceWorker : undefined,
  };
}
