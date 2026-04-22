import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import type { StoredWad } from '../types';
import { putWad } from '../lib/wadStore';
import { sha1Hex } from '../lib/sha1';

interface Props {
  /** Container whose fullscreen state we toggle. */
  containerRef: React.RefObject<HTMLElement>;
  /** True when the engine is actively rendering (hide upload hint once playing). */
  running: boolean;
  /** Show the "click to enable sound" hint for unmuted autoplay. */
  audioLocked: boolean;
  /** Called when the user clicks the canvas/hint to dismiss the audio hint. */
  onAudioUnlock: () => void;
}

/**
 * In-panel overlay: fullscreen toggle, WAD upload, and audio-unlock hint.
 * Kept minimal on purpose — pause is available via the in-game `P` key,
 * and full audio mute requires invasive AudioContext patching which is
 * deferred to a later release.
 */
export const Hud: React.FC<Props> = ({ containerRef, running, audioLocked, onAudioUnlock }) => {
  const styles = useStyles2(getStyles);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [isFullscreen, setFullscreen] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  useEffect(() => {
    const onFsChange = () => setFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
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
    if (!file) return;
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
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  return (
    <>
      {audioLocked && (
        <button
          type="button"
          className={styles.audioHint}
          onClick={onAudioUnlock}
          aria-label="Click to enable sound"
        >
          🔊 Click to enable sound
        </button>
      )}
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
  audioHint: css`
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    appearance: none;
    border: 1px solid ${theme.colors.primary.border};
    background: ${theme.colors.primary.main};
    color: ${theme.colors.primary.contrastText};
    padding: 6px 12px;
    font-size: 12px;
    border-radius: ${theme.shape.radius.default};
    cursor: pointer;
    z-index: 4;
    pointer-events: auto;
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
