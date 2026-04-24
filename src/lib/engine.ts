/**
 * Emscripten Module loader for cloudflare/doom-wasm.
 *
 * Design notes:
 *   - The upstream build flags (configure.ac) set INVOKE_RUN=1 and do NOT
 *     export `callMain` on Module. So we rely on the glue's own auto-start
 *     path: set `Module.arguments`, mount the WAD in `preRun`, let the glue
 *     call main() itself after wasm init.
 *   - The glue is non-MODULARIZE; it mutates `window.Module`. Only one engine
 *     instance can live per page, so we enforce a singleton guard.
 */
import type { ControlPreset } from '../types';
import { ASSET_URLS } from './assets';

export interface EngineStartOptions {
  canvas: HTMLCanvasElement;
  wad: ArrayBuffer;
  wadFilename?: string;
  muted?: boolean;
  controls?: ControlPreset;
  enableMouse?: boolean;
  gameScale?: number;
  onStdout?: (line: string) => void;
  onError?: (err: unknown) => void;
}

export interface EngineHandle {
  live: boolean;
  reason?: string;
  dispose: () => void;
}

interface EmscriptenModule {
  canvas: HTMLCanvasElement;
  noExitRuntime?: boolean;
  arguments?: string[];
  preRun?: Array<() => void>;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
  wasmBinary?: ArrayBuffer;
  locateFile?: (path: string, prefix: string) => string;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  FS: { writeFile: (path: string, data: Uint8Array) => void };
}

let engineClaimed = false;
let scriptLoaded = false;
let glueScriptEl: HTMLScriptElement | null = null;

let _audioCtx: AudioContext | null = null;

let persistentCanvas: HTMLCanvasElement | null = null;
let parkingHost: HTMLDivElement | null = null;

function ensureParkingHost(): HTMLDivElement {
  if (parkingHost && parkingHost.isConnected) {
    return parkingHost;
  }
  const host = document.createElement('div');
  host.id = 'goom-canvas-parking';
  host.style.cssText =
    'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  parkingHost = host;
  return host;
}

/**
 * Lazily create and return the single persistent `<canvas>` element that
 * hosts the doom-wasm WebGL context. The element is parented to a hidden
 * parking <div> on document.body so its WebGL context survives across
 * panel React unmount/remount cycles (edit mode, dashboard switch, etc.).
 */
export function getEngineCanvas(initialWidth?: number, initialHeight?: number): HTMLCanvasElement {
  if (persistentCanvas) {
    return persistentCanvas;
  }
  const c = document.createElement('canvas');
  c.id = 'goom-engine-canvas';
  c.setAttribute('aria-label', 'Classic FPS game');
  c.tabIndex = 0;
  c.width = Math.max(320, Math.floor(initialWidth ?? 640));
  c.height = Math.max(240, Math.floor(initialHeight ?? 400));
  ensureParkingHost().appendChild(c);
  persistentCanvas = c;
  return c;
}

/**
 * Move the persistent engine canvas back to its hidden parking container.
 * Call this on panel unmount so the WebGL context stays alive without
 * the now-detached panel DOM attempting to re-parent it implicitly.
 */
export function parkEngineCanvas(): void {
  if (!persistentCanvas) {
    return;
  }
  const host = ensureParkingHost();
  if (persistentCanvas.parentNode !== host) {
    host.appendChild(persistentCanvas);
  }
}

/**
 * Must be called inside a user-gesture handler to satisfy browser autoplay
 * policy before the Emscripten SDL audio context starts.
 */
export function primeEngineAudioContext(): void {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') {
      void _audioCtx.resume().catch(() => undefined);
    }
  } catch {
    // AudioContext not available — ignore.
  }
}

function loadGlueScript(src: string): Promise<void> {
  if (scriptLoaded) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      scriptLoaded = true;
      glueScriptEl = s;
      resolve();
    };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Quiesce the doom-wasm engine for a panel unmount without destroying it.
 *
 * The Emscripten glue cannot be cleanly re-initialised on this page (stale
 * async callbacks would emit `Module is not defined`, and the WebGL context
 * is bound to its original canvas). Instead we keep `window.Module`, the
 * glue script, and all SDL/JSEvents listeners alive, and merely:
 *
 *   1. Pause the Emscripten main loop (`Module.pauseMainLoop` /
 *      `Browser.mainLoop.pause`).
 *   2. Re-parent the persistent engine canvas back to the hidden parking
 *      host on `document.body`, so the WebGL context survives the React
 *      unmount of the panel.
 *
 * On the next `startEngine()` call for a fresh mount, the canvas is moved
 * back into the new wrap and the main loop is resumed — giving a true
 * hot-remount without page reload.
 */
function teardownEngine(): void {
  const win = window as unknown as {
    Module?: { pauseMainLoop?: () => void };
    JSEvents?: { removeAllEventListeners?: () => void };
    Browser?: { mainLoop?: { pause?: () => void } };
  };

  try {
    win.Module?.pauseMainLoop?.();
  } catch {
    // ignore
  }
  try {
    win.Browser?.mainLoop?.pause?.();
  } catch {
    // ignore
  }
  parkEngineCanvas();
}

/**
 * Build a chocolate-doom default.cfg with key bindings matching the chosen
 * control preset. The engine's compiled-in defaults bind movement to arrow
 * keys (KEY_UPARROW etc.), so the WASD preset must write an override config;
 * otherwise W/S/A/D produce no gameplay input even though the keys reach SDL.
 *
 * Scancodes here are DOS-style scancodes (see `m_config.c` `scantokey[]`):
 * 17=W, 31=S, 30=A, 32=D, 16=Q, 18=E, 57=Space, 29=LCtrl, 42=LShift, 46=C,
 * 72=UpArrow, 75=LeftArrow, 77=RightArrow, 80=DownArrow, 87=F11. Values must
 * be in the range 0..127, otherwise chocolate-doom silently rewrites them to
 * 0 during config load.
 */
function buildDefaultCfg(preset: ControlPreset | undefined): string {
  const wasd = preset !== 'vanilla';
  const lines: Array<[string, string | number]> = [
    ['use_libsamplerate', 0],
    ['force_software_renderer', 0],
    ['startup_delay', 0],
    ['show_diskicon', 1],
    ['grabmouse', 0],
    ['fullscreen', 0],
    ['sfx_volume', 8],
    ['music_volume', 8],
    ['show_messages', 1],
    ['novert', 1],
    // In WASD preset, A/D must strafe (not turn); turning is handled by the
    // mouse (Arrow keys still turn as a fallback). Pinning key_left/key_right
    // to arrow scancodes keeps A/D exclusively on strafe.
    ['key_right', 77],
    ['key_left', 75],
    ['key_up', wasd ? 17 : 72],
    ['key_down', wasd ? 31 : 80],
    ['key_strafeleft', wasd ? 30 : 44],
    ['key_straferight', wasd ? 32 : 46],
    ['key_fire', wasd ? 57 : 29],
    ['key_use', wasd ? 18 : 57],
    ['key_strafe', 46],
    ['key_speed', 42],
    ['key_strafe_alt', 46],
    ['key_speed_alt', 42],
    ['key_fullscreen', 33],
    ['use_mouse', 1],
    ['use_joystick', 0],
    ['screenblocks', 10],
    ['detaillevel', 0],
    ['snd_channels', 8],
    ['snd_musicdevice', 3],
    ['snd_sfxdevice', 3],
    ['usegamma', 0],
    ['mouse_sensitivity', 5],
    ['mouseb_fire', 0],
    ['mouseb_strafe', 1],
    ['mouseb_forward', 2],
  ];
  return lines.map(([k, v]) => `${k.padEnd(30)}${v}`).join('\n') + '\n';
}

export async function startEngine(opts: EngineStartOptions): Promise<EngineHandle> {
  if (engineClaimed) {
    // Hot re-mount: engine already initialised on this page. The caller has
    // already re-parented `opts.canvas` (the persistent canvas) into the
    // new wrap. Resume the paused main loop and return a fresh handle.
    const win = window as unknown as {
      Module?: {
        resumeMainLoop?: () => void;
        canvas?: HTMLCanvasElement;
      };
      Browser?: { mainLoop?: { resume?: () => void } };
    };
    try {
      if (win.Module) {
        win.Module.canvas = opts.canvas;
      }
    } catch {
      // ignore
    }
    try {
      win.Module?.resumeMainLoop?.();
    } catch {
      // ignore
    }
    try {
      win.Browser?.mainLoop?.resume?.();
    } catch {
      // ignore
    }
    return {
      live: true,
      dispose: () => {
        teardownEngine();
      },
    };
  }
  engineClaimed = true;

  const wadName = opts.wadFilename ?? 'active.wad';

  let wasmBinary: ArrayBuffer;
  try {
    const res = await fetch(ASSET_URLS.wasmBin());
    if (!res.ok) {
      throw new Error(`wasm fetch ${res.status}`);
    }
    wasmBinary = await res.arrayBuffer();
  } catch (err) {
    engineClaimed = false;
    throw err;
  }

  const cfgText = buildDefaultCfg(opts.controls);
  const pending: Partial<EmscriptenModule> = {
    canvas: opts.canvas,
    noExitRuntime: true,
    wasmBinary,
    arguments: [
      '-iwad', `/${wadName}`,
      '-config', '/default.cfg',
      '-window',
      '-nogui',
      ...(opts.muted ? ['-nosound', '-nomusic'] : ['-nomusic']),
    ],
    preRun: [
      () => {
        const mod = (window as unknown as { Module: EmscriptenModule }).Module;
        mod.FS.writeFile(`/${wadName}`, new Uint8Array(opts.wad));
        mod.FS.writeFile('/default.cfg', new TextEncoder().encode(cfgText));
      },
    ],
    print: (t: string) => opts.onStdout?.(t),
    printErr: (t: string) => opts.onStdout?.(`[err] ${t}`),
    onAbort: (what) => opts.onError?.(what),
    locateFile: (path: string) => (path.endsWith('.wasm') ? ASSET_URLS.wasmBin() : path),
  };

  (window as unknown as { Module: Partial<EmscriptenModule> }).Module = pending;

  await loadGlueScript(ASSET_URLS.wasmJs());

  return {
    live: true,
    dispose: () => {
      teardownEngine();
    },
  };
}
