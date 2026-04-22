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

export async function startEngine(opts: EngineStartOptions): Promise<EngineHandle> {
  if (engineClaimed) {
    return {
      live: false,
      reason: 'Another Goom panel on this page already owns the engine.',
      dispose: () => void 0,
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

  const pending: Partial<EmscriptenModule> = {
    canvas: opts.canvas,
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
        const mod = (window as unknown as { Module: EmscriptenModule }).Module;
        mod.FS.writeFile(`/${wadName}`, new Uint8Array(opts.wad));
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
      try {
        delete (window as unknown as { Module?: unknown }).Module;
      } catch {
        (window as unknown as { Module?: unknown }).Module = undefined;
      }
    },
  };
}
