import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import type { GoomOptions } from '../types';
import { startEngine, type EngineHandle } from '../lib/engine';
import { resolveWad, type ResolvedWad } from '../lib/resolveWad';
import { Hud } from './Hud';

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const [status, setStatus] = useState<'loading' | 'running' | 'error' | 'duplicate'>('loading');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [wadInfo, setWadInfo] = useState<ResolvedWad | null>(null);
  const [userUnlockedAudio, setUserUnlockedAudio] = useState(false);
  // Autoplay policy: unmuted engine needs a user gesture. Show the hint
  // whenever the panel would start unmuted and the user hasn't clicked yet.
  const audioLocked =
    options.autoStart && !options.muteOnLoad && !userUnlockedAudio && status === 'loading';

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) {return;}
    if (handleRef.current) {return;}

    if (!options.autoStart) {
      // Initial status is already 'loading'; nothing else to do when
      // autoStart is off — the user will trigger engine boot later.
      return;
    }

    (async () => {
      try {
        setStatus('loading');
        const wad = await resolveWad(options);
        if (cancelled) {return;}
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
        if (!handle.live) {
          setStatus('duplicate');
          setErrMsg(handle.reason ?? 'Engine already running elsewhere.');
          return;
        }
        // Give the glue a moment to init, then assume running.
        // (We can't observe callMain directly — the build doesn't export it.)
        setTimeout(() => {
          if (!cancelled) {setStatus('running');}
        }, 800);
      } catch (err) {
        if (cancelled) {return;}
        setStatus('error');
        setErrMsg(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      // Do not dispose here: engine is single-instance per page; Grafana
      // re-mounts the panel on resize/config tweaks and we'd kill the game.
    };
  }, [options]);

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        width={Math.max(320, Math.floor(width))}
        height={Math.max(200, Math.floor(height))}
        tabIndex={0}
        aria-label="Classic FPS game"
        onClick={() => setUserUnlockedAudio(true)}
        onKeyDown={() => setUserUnlockedAudio(true)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <Hud
        containerRef={wrapRef}
        running={status === 'running'}
        audioLocked={audioLocked}
        onAudioUnlock={() => {
          setUserUnlockedAudio(true);
          canvasRef.current?.focus();
        }}
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
          {status === 'duplicate' && (
            <>
              <div className={styles.title}>Only one Goom at a time</div>
              <div className={styles.sub}>{errMsg}</div>
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
    max-width: 320px;
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
