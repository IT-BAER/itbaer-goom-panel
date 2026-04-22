/**
 * Emscripten Module loader for cloudflare/doom-wasm.
 *
 * Responsibilities:
 *   - Fetch doom.wasm binary (and doom.js glue) from the plugin's public path.
 *   - Fetch the selected IWAD (bundled Freedoom, IndexedDB-cached, or URL).
 *   - Mount the WAD into Emscripten's MEMFS at a known path and call main().
 *   - Expose a disposable handle so the panel can re-mount on option changes.
 *
 * The engine itself is chocolate-doom; we do not patch it. We drive it via
 * Module config (canvas, arguments, preRun, FS writes).
 */
import type { ControlPreset } from '../types';
import { ASSET_URLS } from './assets';

export interface EngineStartOptions {
  canvas: HTMLCanvasElement;
  wad: ArrayBuffer;
  /** File name the engine sees (must match the -iwad arg). */
  wadFilename?: string;
  muted?: boolean;
  controls?: ControlPreset;
  onStdout?: (line: string) => void;
  onError?: (err: unknown) => void;
}

export interface EngineHandle {
  /** Stop the engine and release Module handles. Safe to call more than once. */
  dispose: () => void;
  /** True once the game has called `callMain`. */
  running: () => boolean;
}

// Minimal Emscripten Module shape we actually use.
interface EmscriptenModule {
  canvas: HTMLCanvasElement;
  noInitialRun: boolean;
  noExitRuntime: boolean;
  arguments?: string[];
  preRun?: Array<() => void>;
  onRuntimeInitialized?: () => void;
  onAbort?: (what: unknown) => void;
  wasmBinary?: ArrayBuffer;
  locateFile?: (path: string, prefix: string) => string;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
  };
  callMain: (args: string[]) => number;
  exit?: (status: number) => void;
}

let scriptLoaded = false;

function loadGlueScript(src: string): Promise<void> {
  if (scriptLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    // The Emscripten glue uses IIFE / ESM-style depending on build flags;
    // the cloudflare build exposes itself on `window` as `Module` factory via
    // the default (non-MODULARIZE) template. Re-loading the script attaches
    // to window; we keep a single-load guard for safety.
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

export async function startEngine(opts: EngineStartOptions): Promise<EngineHandle> {
  const wadName = opts.wadFilename ?? 'active.wad';
  const wasmBinary = await (await fetch(ASSET_URLS.wasmBin())).arrayBuffer();

  // Load the glue script. (cloudflare/doom-wasm default build is non-MODULARIZE:
  // it expects a global `Module` that it mutates. We pre-populate window.Module.)
  const pending: Partial<EmscriptenModule> = {
    canvas: opts.canvas,
    noInitialRun: true,
    noExitRuntime: true,
    wasmBinary,
    arguments: [
      '-iwad', `/${wadName}`,
      '-window',
      '-nogui',
      ...(opts.muted ? ['-nosound', '-nomusic'] : []),
    ],
    preRun: [
      () => {
        const fs = (pending as EmscriptenModule).FS;
        fs.writeFile(`/${wadName}`, new Uint8Array(opts.wad));
      },
    ],
    print: (t: string) => opts.onStdout?.(t),
    printErr: (t: string) => opts.onStdout?.(`[err] ${t}`),
    onAbort: (what) => opts.onError?.(what),
    locateFile: (path: string) => {
      // doom.js tries to resolve doom.wasm next to itself by default; we serve
      // from the same plugin public/wasm/ path and also pass wasmBinary above
      // so this callback is primarily defensive.
      if (path.endsWith('.wasm')) return ASSET_URLS.wasmBin();
      return path;
    },
  };

  // Expose as window.Module *before* loading the script (non-MODULARIZE contract).
  (window as unknown as { Module: Partial<EmscriptenModule> }).Module = pending;

  await loadGlueScript(ASSET_URLS.wasmJs());

  // After the glue script runs, `Module` on window is the hydrated instance.
  const mod = (window as unknown as { Module: EmscriptenModule }).Module;

  let running = false;
  let disposed = false;

  await new Promise<void>((resolve, reject) => {
    // If the runtime is already initialized (script loaded synchronously), call now.
    const origInit = mod.onRuntimeInitialized;
    mod.onRuntimeInitialized = () => {
      try {
        origInit?.();
        if (disposed) return;
        mod.callMain(mod.arguments ?? []);
        running = true;
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    // Safety net: Emscripten sets FS during preRun; if the script already
    // finished initializing before we assigned the hook, force-start.
    setTimeout(() => {
      if (!running && !disposed) {
        try {
          mod.callMain(mod.arguments ?? []);
          running = true;
          resolve();
        } catch {
          /* ignore — waited path will either resolve or error on its own */
        }
      }
    }, 2000);
  });

  return {
    running: () => running,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        mod.exit?.(0);
      } catch {
        /* ignore */
      }
      // Best-effort: drop the global. The engine is single-instance per page;
      // remounting requires a page reload. A future v2 could use MODULARIZE.
      try {
        delete (window as unknown as { Module?: unknown }).Module;
      } catch {
        (window as unknown as { Module?: unknown }).Module = undefined;
      }
    },
  };
}
