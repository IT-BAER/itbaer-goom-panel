import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import type { GoomOptions } from '../types';
import { startEngine, type EngineHandle } from '../lib/engine';
import { resolveWad, type ResolvedWad } from '../lib/resolveWad';

interface Props {
  options: GoomOptions;
  width: number;
  height: number;
}

/**
 * Hosts the engine canvas and drives the mount/dispose lifecycle.
 * Design goal: zero-click play — on mount, resolve the WAD + boot the engine.
 */
export const GameCanvas: React.FC<Props> = ({ options, width, height }) => {
  const styles = useStyles2(getStyles);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const [status, setStatus] = useState<'loading' | 'running' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [wadInfo, setWadInfo] = useState<ResolvedWad | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Engine runs once per page (single global Module). If a previous panel
    // instance owns it, skip remount — user must reload to switch WADs in v1.
    if (handleRef.current) return;

    if (!options.autoStart) {
      setStatus('loading');
      return;
    }

    (async () => {
      try {
        setStatus('loading');
        const wad = await resolveWad(options);
        if (cancelled) return;
        setWadInfo(wad);
        const handle = await startEngine({
          canvas,
          wad: wad.bytes,
          wadFilename: wad.name,
          muted: options.muteOnLoad,
          controls: options.controls,
          onError: (err) => {
            setStatus('error');
            setErrMsg(String(err));
          },
        });
        if (cancelled) {
          handle.dispose();
          return;
        }
        handleRef.current = handle;
        setStatus('running');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setErrMsg(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      // Do not dispose here: the engine is single-instance per page, and
      // Grafana re-mounts the panel on any size/config tweak. Disposing would
      // kill the game mid-play. Full lifecycle returns with MODULARIZE in v2.
    };
  }, [options]);

  return (
    <div className={styles.wrap} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={Math.max(320, Math.floor(width))}
        height={Math.max(200, Math.floor(height))}
        tabIndex={0}
        aria-label="Classic FPS game"
        onContextMenu={(e) => e.preventDefault()}
      />
      {status !== 'running' && (
        <div className={styles.overlay} role="status" aria-live="polite">
          {status === 'loading' && (
            <>
              <div className={styles.title}>Loading Goom…</div>
              <div className={styles.sub}>
                {wadInfo ? `WAD: ${wadInfo.name}` : 'Fetching WAD + engine'}
              </div>
            </>
          )}
          {status === 'error' && (
            <>
              <div className={styles.title}>Engine failed to start</div>
              <pre className={styles.err}>{errMsg}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    position: relative;
    background: #000;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: ${theme.shape.radius.default};
  `,
  canvas: css`
    display: block;
    image-rendering: pixelated;
    max-width: 100%;
    max-height: 100%;
    outline: none;
    &:focus {
      box-shadow: inset 0 0 0 2px ${theme.colors.primary.main};
    }
  `,
  overlay: css`
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    gap: 4px;
    color: ${theme.colors.text.primary};
    background: rgba(0, 0, 0, 0.6);
    text-align: center;
    pointer-events: none;
  `,
  title: css`
    font-size: 16px;
    font-weight: 600;
  `,
  sub: css`
    font-size: 12px;
    opacity: 0.75;
  `,
  err: css`
    margin-top: 8px;
    padding: 8px;
    max-width: 520px;
    font-size: 12px;
    color: ${theme.colors.error.text};
    background: ${theme.colors.background.secondary};
    pointer-events: auto;
    overflow: auto;
  `,
});
