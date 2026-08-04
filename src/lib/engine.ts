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

/**
 * Doom's own render size is 320x240 once aspect correction is on (the engine
 * default). We ask for a whole multiple of that, expressed in CSS pixels so
 * SDL's devicePixelRatio multiply lands back on the exact pixel grid.
 */
export function engineWindowArgs(gameScale?: number, dpr = window.devicePixelRatio || 1): string[] {
  const scale = Math.min(500, Math.max(100, Number.isFinite(gameScale) ? Number(gameScale) : 325)) / 100;
  const ratio = dpr > 0 ? dpr : 1;
  return [
    '-width', String(Math.max(320, Math.round((320 * scale) / ratio))),
    '-height', String(Math.max(240, Math.round((240 * scale) / ratio))),
  ];
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

let _audioCtx: AudioContext | null = null;
// Single source of truth for runtime mute. Every path that resumes audio on a
// user gesture must honour it, or clicking the game silently unmutes.
let _muted = false;

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

/**
 * Resume engine audio after a user gesture, unless the user has muted. The
 * single entry point for this: resuming the SDL2 context directly bypasses the
 * mute flag and makes clicking the game unmute it.
 */
export function resumeEngineAudio(): void {
  primeEngineAudioContext();
  applyMuteState();
}

/**
 * Runtime mute. Silences the game by cutting SDL2's output node from the audio graph, with no
 * engine restart. See applyMuteState for why suspending the context is wrong.
 * Separate from the `Mute on load` option, which passes
 * `-nosound` and can only take effect on the next boot.
 */
export function setEngineMuted(muted: boolean): void {
  _muted = muted;
  applyMuteState();
}

/** Current runtime mute state, so UI can render the right icon after a remount. */
export function isEngineMuted(): boolean {
  return _muted;
}

/**
 * Mute by disconnecting SDL2's output node from the destination, NOT by
 * suspending the AudioContext. Emscripten installs an `autoResumeAudioContext`
 * handler that resumes the context on any keydown/mousedown, so a suspended
 * context silently comes back the moment the player presses a key — the button
 * would still read muted while sound returned. A graph edit survives that.
 */
function applyMuteState(): void {
  const sdl = (window as unknown as {
    Module?: { SDL2?: { audioContext?: AudioContext; audio?: { scriptProcessorNode?: AudioNode } } };
  }).Module?.SDL2;
  const node = sdl?.audio?.scriptProcessorNode;
  const ctx = sdl?.audioContext;

  if (!node || !ctx) {
    return;
  }
  try {
    if (_muted) {
      node.disconnect();
    } else {
      node.connect(ctx.destination);
    }
  } catch {
    // Node already disconnected or context torn down — nothing to do.
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
const cfgText = (lines: Array<[string, string | number]>) =>
  lines.map(([k, v]) => `${k.padEnd(30)}${v}`).join('\n') + '\n';

/**
 * The engine splits its settings across TWO files: `doom_defaults_list` keys go
 * in the main config, `extra_defaults_list` keys only in the extra config
 * (`m_config.c`). Writing an extra key into the main file is silently ignored —
 * that is why `novert` never took effect and vertical mouse kept moving the
 * player. Must be passed as `-extraconfig`.
 */
function buildExtraCfg(): string {
  return cfgText([
    ['use_libsamplerate', 0],
    ['force_software_renderer', 0],
    ['startup_delay', 0],
    ['show_diskicon', 1],
    ['grabmouse', 0],
    ['fullscreen', 0],
    // Ignore all vertical mouse movement, so looking up/down never walks the
    // player forward or back.
    ['novert', 1],
    // Must stay 1: the 4:3 render size it selects is what the canvas backbuffer
    // is sized against (see DOOM_RENDER_HEIGHT = 240).
    ['aspect_ratio_correct', 1],
  ]);
}

function buildDefaultCfg(preset: ControlPreset | undefined): string {
  const wasd = preset !== 'vanilla';
  const lines: Array<[string, string | number]> = [
    ['sfx_volume', 8],
    ['music_volume', 8],
    ['show_messages', 1],
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
    // Middle mouse button, not vertical movement — kept off the Y axis.
    ['mouseb_forward', 2],
  ];
  return cfgText(lines);
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

  const mainCfg = buildDefaultCfg(opts.controls);
  const extraCfg = buildExtraCfg();
  const pending: Partial<EmscriptenModule> = {
    canvas: opts.canvas,
    noExitRuntime: true,
    wasmBinary,
    arguments: [
      '-iwad', `/${wadName}`,
      '-config', '/default.cfg',
      '-extraconfig', '/extra.cfg',
      '-window',
      '-nogui',
      // The engine owns the backbuffer: SDL sizes the canvas to these logical
      // dimensions times devicePixelRatio. Without them it uses its 800x600
      // default, which leaves unpainted bars wherever our canvas is bigger.
      ...engineWindowArgs(opts.gameScale),
      ...(opts.muted ? ['-nosound', '-nomusic'] : ['-nomusic']),
    ],
    preRun: [
      () => {
        const mod = (window as unknown as { Module: EmscriptenModule }).Module;
        mod.FS.writeFile(`/${wadName}`, new Uint8Array(opts.wad));
        mod.FS.writeFile('/default.cfg', new TextEncoder().encode(mainCfg));
        mod.FS.writeFile('/extra.cfg', new TextEncoder().encode(extraCfg));
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
