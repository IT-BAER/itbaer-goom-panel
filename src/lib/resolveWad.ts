/**
 * Resolve the active IWAD bytes for the panel, based on the selected wadSource.
 */
import type { GoomOptions, StoredWad } from '../types';
import { ASSET_URLS } from './assets';
import { getWad, putWad } from './wadStore';
import { sha1Hex } from './sha1';

export interface ResolvedWad {
  bytes: ArrayBuffer;
  name: string;
  sha: string;
  source: 'freedoom' | 'user' | 'url';
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`WAD fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.arrayBuffer();
}

export async function resolveWad(options: GoomOptions): Promise<ResolvedWad> {
  // 1. User-selected cached WAD.
  if (options.wadSource === 'user' && options.wadSha) {
    const row = await getWad(options.wadSha);
    if (row) {
      return { bytes: row.bytes, name: row.name, sha: row.sha, source: 'user' };
    }
    // Fall through to freedoom if cache got cleared.
  }

  // 2. WAD from URL, cached by SHA on first fetch.
  if (options.wadSource === 'url' && options.wadUrl) {
    const url = safeHttpUrl(options.wadUrl);
    const bytes = await fetchBytes(url);
    const sha = await sha1Hex(bytes);
    const cached = await getWad(sha);
    if (!cached) {
      const row: StoredWad = {
        sha,
        name: deriveName(url),
        bytes,
        size: bytes.byteLength,
        origin: 'url',
        url,
        addedAt: Date.now(),
      };
      await putWad(row);
    }
    return { bytes, name: deriveName(url), sha, source: 'url' };
  }

  // 3. Default: bundled Freedoom.
  const bytes = await fetchBytes(ASSET_URLS.freedoom());
  const sha = await sha1Hex(bytes);
  return { bytes, name: 'freedoom1.wad', sha, source: 'freedoom' };
}

/** Only allow http(s) URLs. Throws on anything else. */
export function safeHttpUrl(input: string): string {
  const u = new URL(input);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Refusing non-http(s) WAD URL: ${u.protocol}`);
  }
  return u.toString();
}

function deriveName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || 'remote.wad';
  } catch {
    return 'remote.wad';
  }
}
