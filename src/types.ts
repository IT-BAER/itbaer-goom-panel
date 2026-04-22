/**
 * Goom panel plugin — options & shared types.
 *
 * `wadSource` picks which IWAD the engine loads on panel mount:
 *   - 'freedoom' → bundled freedoom1.wad (default; zero-click play).
 *   - 'user'     → WAD uploaded by the user, cached in IndexedDB by sha1.
 *   - 'url'      → WAD fetched from `wadUrl` and cached in IndexedDB.
 */
export type WadSource = 'freedoom' | 'user' | 'url';
export type ControlPreset = 'wasd' | 'vanilla';

export interface GoomOptions {
  wadSource: WadSource;
  /** SHA-1 (hex) of the currently selected cached WAD when wadSource=user. */
  wadSha?: string;
  /** HTTP(S) URL for wadSource=url. */
  wadUrl?: string;
  /** Default keyboard mapping. */
  controls: ControlPreset;
  /** Start the engine muted. Audio unlocks on first user gesture regardless. */
  muteOnLoad: boolean;
  /** If false, panel shows a "Press Play" splash instead of auto-booting. */
  autoStart: boolean;
}

export const defaultGoomOptions: GoomOptions = {
  wadSource: 'freedoom',
  controls: 'wasd',
  muteOnLoad: false,
  autoStart: true,
};

/** Row stored in IndexedDB for a user-supplied WAD. */
export interface StoredWad {
  /** SHA-1 hex; primary key. */
  sha: string;
  /** Display name shown in WadManager. */
  name: string;
  /** Raw WAD bytes. */
  bytes: ArrayBuffer;
  /** Byte length (derived, stored to avoid reading `bytes` just for size). */
  size: number;
  /** Source: 'upload' or 'url'. */
  origin: 'upload' | 'url';
  /** Source URL when origin='url'. */
  url?: string;
  /** When we cached it (ms since epoch). */
  addedAt: number;
}
