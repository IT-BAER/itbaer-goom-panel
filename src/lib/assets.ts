/**
 * Resolve an asset URL under this plugin's public/ namespace.
 *
 * Grafana serves files emitted to `dist/` at `/public/plugins/<plugin-id>/...`.
 * `__webpack_public_path__` is set by scaffolder-injected code to that prefix,
 * so we reuse it and avoid hardcoding the plugin id.
 */
declare const __webpack_public_path__: string;

export function pluginAsset(relative: string): string {
  const base = typeof __webpack_public_path__ === 'string' ? __webpack_public_path__ : '';
  const rel = relative.replace(/^\/+/, '');
  return `${base}${rel}`;
}

export const ASSET_URLS = {
  wasmJs:   () => pluginAsset('wasm/doom.js'),
  wasmBin:  () => pluginAsset('wasm/doom.wasm'),
  freedoom: () => pluginAsset('public/wads/freedoom1.wad'),
} as const;
