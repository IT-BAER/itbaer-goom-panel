import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import type { StoredWad } from '../types';
import { putWad } from '../lib/wadStore';
import { isEngineMuted, setEngineMuted } from '../lib/engine';
import { sha1Hex } from '../lib/sha1';

interface Props {
  /** Container whose fullscreen state we toggle. */
  containerRef: React.RefObject<HTMLElement>;
  /** True when the engine is actively rendering (hide upload hint once playing). */
  running: boolean;
  /** Initial state of the mute toggle, from the `Mute on load` panel option. */
  mutedOnLoad: boolean;
}

/**
 * In-panel overlay: fullscreen toggle, audio mute, and WAD upload.
 * The mute button suspends the engine's AudioContext, so it takes effect
 * immediately; the `Mute on load` panel option only applies on the next engine
 * boot. Pause is available via the in-game `P` key.
 */
export const Hud: React.FC<Props> = ({ containerRef, running, mutedOnLoad }) => {
  const styles = useStyles2(getStyles);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isFullscreen, setFullscreen] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(() => isEngineMuted() || mutedOnLoad);

  useEffect(() => {
    const onFsChange = () => setFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      setEngineMuted(next);
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) {return;}
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (err) {
      setUploadMsg(`Fullscreen denied: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [containerRef]);

  const onFilePick = useCallback(async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) {return;}
    try {
      const bytes = await file.arrayBuffer();
      const sha = await sha1Hex(bytes);
      const row: StoredWad = {
        sha,
        name: file.name,
        bytes,
        size: bytes.byteLength,
        origin: 'upload',
        addedAt: Date.now(),
      };
      await putWad(row);
      setUploadMsg(
        `Saved "${file.name}" (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). ` +
          `Set Panel options → WAD source = User, WAD SHA-1 = ${sha.slice(0, 12)}…`
      );
    } catch (err) {
      setUploadMsg(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileRef.current) {fileRef.current.value = '';}
    }
  }, []);

  return (
    <>
      <div className={styles.hud}>
        <button
          type="button"
          className={styles.btn}
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Go fullscreen'}
          aria-label="Toggle fullscreen"
        >
          {isFullscreen ? '⤡' : '⤢'}
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={toggleMuted}
          title={muted ? 'Unmute audio' : 'Mute audio'}
          aria-label="Toggle audio"
          aria-pressed={muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => fileRef.current?.click()}
          title="Upload a WAD file (cached in this browser)"
          aria-label="Upload WAD"
        >
          📂
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".wad,.WAD"
          onChange={onFilePick}
          className={styles.file}
          aria-hidden
        />
      </div>
      {uploadMsg && (
        <div className={styles.toast} role="status" aria-live="polite">
          <span>{uploadMsg}</span>
          <button
            type="button"
            className={styles.toastClose}
            onClick={() => setUploadMsg(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}
      {!running && null /* reserved for future HUD during load */}
    </>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  hud: css`
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 4px;
    z-index: 3;
    opacity: 0.55;
    transition: opacity 120ms ease-out;
    &:hover,
    &:focus-within {
      opacity: 1;
    }
  `,
  btn: css`
    appearance: none;
    border: 1px solid ${theme.colors.border.medium};
    background: rgba(0, 0, 0, 0.55);
    color: ${theme.colors.text.primary};
    width: 28px;
    height: 28px;
    padding: 0;
    font-size: 14px;
    line-height: 1;
    border-radius: ${theme.shape.radius.default};
    cursor: pointer;
    display: grid;
    place-items: center;
    &:hover {
      background: rgba(0, 0, 0, 0.8);
    }
  `,
  file: css`
    display: none;
  `,
  toast: css`
    position: absolute;
    bottom: 8px;
    right: 8px;
    max-width: 60%;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.3;
    background: rgba(0, 0, 0, 0.8);
    color: ${theme.colors.text.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    z-index: 4;
    pointer-events: auto;
  `,
  toastClose: css`
    appearance: none;
    border: none;
    background: transparent;
    color: ${theme.colors.text.secondary};
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
  `,
});
