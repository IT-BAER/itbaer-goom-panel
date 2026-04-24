import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import type { GoomOptions } from '../types';
import { getEngineCanvas, primeEngineAudioContext, startEngine, type EngineHandle } from '../lib/engine';
import { resolveWad, type ResolvedWad } from '../lib/resolveWad';
import { Hud } from './Hud';

interface Props {
  options: GoomOptions;
  width: number;
  height: number;
}

interface GoomWindow extends Window {
  Module?: {
    __doomPointerLockMouseDY?: number;
  };
}

interface SyntheticKeyBinding {
  code: string;
  key: string;
  keyCode: number;
}

const DOOM_RENDER_WIDTH = 320;
const DOOM_RENDER_HEIGHT = 240;

const getFixedCanvasBox = (gameScale: number) => {
  const safeScale = Math.min(500, Math.max(100, Number.isFinite(gameScale) ? gameScale : 325));
  return {
    width: Math.round((DOOM_RENDER_WIDTH * safeScale) / 100),
    height: Math.round((DOOM_RENDER_HEIGHT * safeScale) / 100),
  };
};

const fitPreferredCanvasBox = (
  preferredWidth: number,
  preferredHeight: number,
  availableWidth: number,
  availableHeight: number
) => {
  const safeAvailableWidth = Math.max(1, Math.floor(availableWidth));
  const safeAvailableHeight = Math.max(1, Math.floor(availableHeight));

  if (safeAvailableWidth >= preferredWidth && safeAvailableHeight >= preferredHeight) {
    return {
      width: preferredWidth,
      height: preferredHeight,
    };
  }

  const scale = Math.min(safeAvailableWidth / preferredWidth, safeAvailableHeight / preferredHeight);

  return {
    width: Math.max(1, Math.floor(preferredWidth * scale)),
    height: Math.max(1, Math.floor(preferredHeight * scale)),
  };
};

/**
 * Hosts the engine canvas and drives the mount/dispose lifecycle.
 * Design goal: zero-click play — on mount, resolve the WAD + boot the engine.
 */
export const GameCanvas: React.FC<Props> = ({ options, width, height }) => {
  const styles = useStyles2(getStyles);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keySinkRef = useRef<HTMLInputElement | null>(null);
  const controlsArmedRef = useRef(false);
  const mouseLockedRef = useRef(false);
  const pressedMouseButtonsRef = useRef<Set<number>>(new Set());
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'running' | 'error' | 'duplicate'>(
    options.autoStart ? 'loading' : 'idle'
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [wadInfo, setWadInfo] = useState<ResolvedWad | null>(null);
  const [userUnlockedAudio, setUserUnlockedAudio] = useState(false);
  const [mouseLocked, setMouseLocked] = useState(false);
  const [mouseMessage, setMouseMessage] = useState<string | null>(null);
  const [controlsArmed, setControlsArmed] = useState(false);
  const [engineLive, setEngineLive] = useState(false);
  const audioLocked = false;
  const inputCaptured = status === 'running' && controlsArmed;
  const engineCanvasBox = getFixedCanvasBox(options.gameScale);
  const [displayCanvasBox, setDisplayCanvasBox] = useState(engineCanvasBox);
  const focusKeySink = () => keySinkRef.current?.focus({ preventScroll: true });
  const resumeEngineAudio = () => {
    primeEngineAudioContext();
    const mod = (window as unknown as {
      Module?: { SDL2?: { audioContext?: { resume?: () => Promise<void> } } };
    }).Module;

    void mod?.SDL2?.audioContext?.resume?.().catch(() => undefined);
  };
  const noteUserGesture = () => {
    setUserUnlockedAudio(true);
    resumeEngineAudio();
  };
  const armControls = () => {
    controlsArmedRef.current = true;
    setControlsArmed(true);
  };
  const releaseControls = (exitPointerLock: boolean) => {
    controlsArmedRef.current = false;
    setControlsArmed(false);
    keySinkRef.current?.blur();
    canvasRef.current?.blur();
    setMouseMessage(options.enableMouse === false ? null : 'Controls released. Click game canvas to capture again.');

    if (exitPointerLock && document.pointerLockElement === canvasRef.current) {
      const mod = (window as unknown as {
        Module?: { emscripten_exit_pointerlock?: () => number };
      }).Module;
      mod?.emscripten_exit_pointerlock?.() ?? document.exitPointerLock?.();
    }
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      setDisplayCanvasBox(engineCanvasBox);
      return;
    }

    const updateDisplayCanvasBox = () => {
      const rect = wrap.getBoundingClientRect();
      const next = fitPreferredCanvasBox(
        engineCanvasBox.width,
        engineCanvasBox.height,
        rect.width || width,
        rect.height || height
      );
      setDisplayCanvasBox((current) =>
        current.width === next.width && current.height === next.height ? current : next
      );
    };

    let frame = 0;
    const syncDisplayCanvasBox = () => {
      updateDisplayCanvasBox();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => updateDisplayCanvasBox());
    };

    syncDisplayCanvasBox();

    const observer = new ResizeObserver(() => syncDisplayCanvasBox());
    observer.observe(wrap);
    document.addEventListener('fullscreenchange', syncDisplayCanvasBox);
    window.addEventListener('resize', syncDisplayCanvasBox);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('fullscreenchange', syncDisplayCanvasBox);
      window.removeEventListener('resize', syncDisplayCanvasBox);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineCanvasBox.height, engineCanvasBox.width, height, width]);

  const getMouseButtonBinding = (button: number): SyntheticKeyBinding | null => {
    const wasd = options.controls !== 'vanilla';
    switch (button) {
      case 0:
        // Fire: must match key_fire in buildDefaultCfg — WASD=Space, vanilla=RCtrl.
        return wasd
          ? { code: 'Space', key: ' ', keyCode: 32 }
          : { code: 'ControlRight', key: 'Control', keyCode: 17 };
      case 1:
        // Forward: match key_up — WASD=W, vanilla=ArrowUp.
        return wasd
          ? { code: 'KeyW', key: 'w', keyCode: 87 }
          : { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 };
      case 2:
        // Strafe modifier: match key_strafe (DOS scancode 46 → 'c') for both presets.
        return { code: 'KeyC', key: 'c', keyCode: 67 };
      default:
        return null;
    }
  };

  const dispatchSyntheticKey = (type: 'keydown' | 'keyup', binding: SyntheticKeyBinding) => {
    const event = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      code: binding.code,
      key: binding.key,
    });

    Object.defineProperties(event, {
      keyCode: { configurable: true, get: () => binding.keyCode },
      which: { configurable: true, get: () => binding.keyCode },
      charCode: { configurable: true, get: () => 0 },
    });

    window.dispatchEvent(event);
  };

  const requestMouseCapture = async () => {
    const canvas = canvasRef.current;
    if (!canvas || options.enableMouse === false) {return;}
    setUserUnlockedAudio(true);
    focusKeySink();
    setMouseMessage('Click game again if browser asks for mouse capture.');

    const mod = (window as unknown as {
      Module?: {
        requestFullscreen?: (lockPointer?: boolean, resizeCanvas?: boolean) => void;
        emscripten_request_pointerlock?: (target: Element, deferUntilInEventHandler: boolean) => number;
        emscripten_exit_pointerlock?: () => number;
      };
    }).Module;

    try {
      const result = mod?.emscripten_request_pointerlock?.(canvas, false);
      if (result == null) {
        const fallback = canvas.requestPointerLock?.();
        if (fallback && typeof fallback.then === 'function') {
          await fallback;
        }
      }
    } catch (err) {
      setMouseMessage(`Mouse capture denied: ${err instanceof Error ? err.message : String(err)}`);
    }

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    if (document.pointerLockElement === canvas) {
      return;
    }

    try {
      await wrapRef.current?.requestFullscreen?.();
      setMouseMessage('Fullscreen opened for mouse capture. Click game once more if needed.');
    } catch (err) {
      setMouseMessage(`Mouse capture denied: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const syncBrowserPointerLock = (locked: boolean) => {
    const browser = (window as unknown as { Browser?: { pointerLock?: boolean } }).Browser;
    if (browser) {
      browser.pointerLock = locked;
    }
  };

  const boot = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {return;}
    if (handleRef.current) {return;}
    try {
      setStatus('loading');
      const wad = await resolveWad(options);
      setWadInfo(wad);
      const handle = await startEngine({
        canvas,
        wad: wad.bytes,
        wadFilename: wad.name,
        muted: options.muteOnLoad,
        controls: options.controls,
        enableMouse: options.enableMouse,
        onError: (err) => {
          setStatus('error');
          setErrMsg(String(err));
        },
      });
      handleRef.current = handle;
      setEngineLive(true);
      if (!handle.live) {
        setStatus('duplicate');
        setErrMsg(handle.reason ?? 'Engine already running elsewhere.');
        return;
      }
      setTimeout(() => setStatus('running'), 800);
    } catch (err) {
      setStatus('error');
      setErrMsg(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!options.autoStart) {return;}
    if (audioLocked) {return;}
    if (handleRef.current) {return;}
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const wad = await resolveWad(options);
        if (cancelled) {return;}
        setWadInfo(wad);
        const handle = await startEngine({
          canvas: canvasRef.current!,
          wad: wad.bytes,
          wadFilename: wad.name,
          muted: options.muteOnLoad,
          controls: options.controls,
          enableMouse: options.enableMouse,
          gameScale: options.gameScale,
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
        setEngineLive(true);
        if (!handle.live) {
          setStatus('duplicate');
          setErrMsg(handle.reason ?? 'Engine already running elsewhere.');
          return;
        }
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
    };
  }, [audioLocked, options]);

  useEffect(() => {
    const pressedButtons = pressedMouseButtonsRef.current;
    const wrap = wrapRef.current;
    return () => {
      releaseControls(true);
      pressedButtons.clear();
      handleRef.current?.dispose();
      handleRef.current = null;
      setEngineLive(false);
      if (document.fullscreenElement === wrap) {
        void document.exitFullscreen?.().catch(() => undefined);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach the persistent engine canvas into this panel's wrap on mount,
  // and park it back into the hidden host on unmount. The canvas is a
  // singleton shared across panel re-mounts so its WebGL context survives.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }
    const canvas = getEngineCanvas(engineCanvasBox.width, engineCanvasBox.height);
    canvas.className = styles.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'Classic FPS game');
    canvas.removeAttribute('aria-hidden');
    if (canvas.parentNode !== wrap) {
      wrap.insertBefore(canvas, wrap.firstChild);
    }
    canvasRef.current = canvas;

    const onCanvasClick = () => {
      noteUserGesture();
      armControls();
      if (audioLocked && !handleRef.current) {
        void boot();
        return;
      }
      if (status === 'running' && options.enableMouse !== false) {
        void requestMouseCapture();
        return;
      }
      focusKeySink();
    };
    const onCanvasKeyDown = () => {
      noteUserGesture();
      if (audioLocked && !handleRef.current) {
        void boot();
      }
    };
    const onCanvasContextMenu = (e: Event) => {
      e.preventDefault();
    };

    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('keydown', onCanvasKeyDown);
    canvas.addEventListener('contextmenu', onCanvasContextMenu);

    return () => {
      canvas.removeEventListener('click', onCanvasClick);
      canvas.removeEventListener('keydown', onCanvasKeyDown);
      canvas.removeEventListener('contextmenu', onCanvasContextMenu);
      // Canvas re-parenting back to parking host is handled by
      // teardownEngine() via handleRef.dispose() in the cleanup effect.
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioLocked, status, options.enableMouse, styles.canvas]);

  // Keep the persistent canvas's CSS display size in sync with React state.
  // Do NOT change canvas.width/height after init — that would clear the
  // WebGL context and kill the live game.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.style.width = `${displayCanvasBox.width}px`;
    canvas.style.height = `${displayCanvasBox.height}px`;
  }, [displayCanvasBox.width, displayCanvasBox.height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {return;}

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === canvas;
      const wasLocked = mouseLockedRef.current;
      mouseLockedRef.current = locked;
      syncBrowserPointerLock(locked);
      setMouseLocked(locked);
      if (locked) {
        armControls();
        focusKeySink();
        return;
      }

      if (wasLocked) {
        releaseControls(false);
        return;
      }

      setMouseMessage(locked ? null : options.enableMouse === false ? null : 'Click 🖱 or canvas to capture mouse.');
    };

    const onPointerLockError = () => {
      setMouseLocked(false);
      setMouseMessage('Browser blocked mouse capture. Try 🖱 or fullscreen, then click game.');
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    onPointerLockChange();

    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enableMouse]);

  useEffect(() => {
    if (!inputCaptured) {return;}

    const onWindowKeyCapture = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        releaseControls(true);
        return;
      }

      event.preventDefault();
    };

    window.addEventListener('keydown', onWindowKeyCapture, true);
    window.addEventListener('keypress', onWindowKeyCapture, true);
    window.addEventListener('keyup', onWindowKeyCapture, true);

    return () => {
      window.removeEventListener('keydown', onWindowKeyCapture, true);
      window.removeEventListener('keypress', onWindowKeyCapture, true);
      window.removeEventListener('keyup', onWindowKeyCapture, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputCaptured, options.enableMouse]);

  useEffect(() => {
    if (status !== 'running' || options.enableMouse === false) {return;}

    const win = window as GoomWindow;
    const pressedButtons = pressedMouseButtonsRef.current;

    const zeroVerticalPointerLockMotion = () => {
      if (document.pointerLockElement !== canvasRef.current) {
        return;
      }

      if (typeof win.Module?.__doomPointerLockMouseDY === 'number') {
        win.Module.__doomPointerLockMouseDY = 0;
      }
    };

    const releaseMouseButtons = () => {
      for (const button of Array.from(pressedButtons)) {
        const binding = getMouseButtonBinding(button);
        if (binding) {
          dispatchSyntheticKey('keyup', binding);
        }
      }

      pressedButtons.clear();
    };

    const emulateMouseButtons = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvasRef.current) {
        return;
      }

      const binding = getMouseButtonBinding(event.button);
      if (!binding) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      focusKeySink();

      if (event.type === 'mousedown') {
        if (!pressedButtons.has(event.button)) {
          pressedButtons.add(event.button);
          dispatchSyntheticKey('keydown', binding);
        }
        return;
      }

      if (pressedButtons.delete(event.button)) {
        dispatchSyntheticKey('keyup', binding);
      }
    };

    const suppressPointerLockContextMenu = (event: MouseEvent) => {
      if (document.pointerLockElement !== canvasRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const onPointerLockChange = () => {
      if (document.pointerLockElement !== canvasRef.current) {
        releaseMouseButtons();
      }
    };

    document.addEventListener('mousemove', zeroVerticalPointerLockMotion, true);
    document.addEventListener('mousedown', emulateMouseButtons, true);
    document.addEventListener('mouseup', emulateMouseButtons, true);
    document.addEventListener('contextmenu', suppressPointerLockContextMenu, true);
    document.addEventListener('pointerlockchange', onPointerLockChange, true);

    return () => {
      document.removeEventListener('mousemove', zeroVerticalPointerLockMotion, true);
      document.removeEventListener('mousedown', emulateMouseButtons, true);
      document.removeEventListener('mouseup', emulateMouseButtons, true);
      document.removeEventListener('contextmenu', suppressPointerLockContextMenu, true);
      document.removeEventListener('pointerlockchange', onPointerLockChange, true);
      releaseMouseButtons();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, options.enableMouse]);

  useEffect(() => {
    if (!inputCaptured) {return;}

    const wrap = wrapRef.current;
    const redirectPointerEvent = (event: Event) => {
      if (!controlsArmedRef.current && document.pointerLockElement !== canvasRef.current) {
        return;
      }

      if (document.pointerLockElement === canvasRef.current) {
        return;
      }

      if (wrap && event.target instanceof Node && wrap.contains(event.target)) {
        return;
      }

      releaseControls(true);
    };

    window.addEventListener('pointerdown', redirectPointerEvent, true);
    window.addEventListener('click', redirectPointerEvent, true);
    window.addEventListener('auxclick', redirectPointerEvent, true);
    window.addEventListener('contextmenu', redirectPointerEvent, true);
    window.addEventListener('wheel', redirectPointerEvent, { capture: true, passive: false });

    return () => {
      window.removeEventListener('pointerdown', redirectPointerEvent, true);
      window.removeEventListener('click', redirectPointerEvent, true);
      window.removeEventListener('auxclick', redirectPointerEvent, true);
      window.removeEventListener('contextmenu', redirectPointerEvent, true);
      window.removeEventListener('wheel', redirectPointerEvent, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputCaptured]);

  useEffect(() => {
    if (!inputCaptured) {return;}

    const onFocusIn = () => {
      if (document.activeElement === keySinkRef.current) {return;}
      focusKeySink();
    };

    document.addEventListener('focusin', onFocusIn, true);
    onFocusIn();

    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [inputCaptured]);

  useEffect(() => {
    if (!inputCaptured) {return;}
    focusKeySink();
  }, [inputCaptured, mouseLocked]);

  return (
    <div ref={wrapRef} className={styles.wrap} style={{ width, height }}>
      <input
        ref={keySinkRef}
        className={styles.keySink}
        tabIndex={-1}
        aria-hidden="true"
      />
      {/* The engine canvas is a persistent singleton managed outside React
          (see getEngineCanvas/parkEngineCanvas in lib/engine.ts). It is
          appended into this wrap on mount and moved back to a hidden
          parking host on unmount, keeping the WebGL context alive across
          panel re-mounts (edit mode, dashboard switch, etc.). */}
      <Hud
        containerRef={wrapRef}
        running={status === 'running'}
      />
      {status !== 'running' && (
        <div className={styles.overlay} role="status" aria-live="polite">
          {status === 'idle' && (
            <>
              <div className={styles.title}>Goom</div>
              <div className={styles.sub}>Click play to load Freedoom and start the engine.</div>
              <button
                type="button"
                className={styles.playBtn}
                onClick={() => {
                  noteUserGesture();
                  void boot();
                }}
              >
                ▶ Play
              </button>
            </>
          )}
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
              <div className={styles.title}>Reload to restart Goom</div>
              <div className={styles.sub}>{errMsg}</div>
              <button
                type="button"
                className={styles.playBtn}
                onClick={() => window.location.reload()}
              >
                ↻ Reload page
              </button>
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
    &:fullscreen,
    &:-webkit-full-screen {
      width: 100vw !important;
      height: 100vh !important;
      border-radius: 0;
    }
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
  keySink: css`
    position: absolute;
    left: -10000px;
    top: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
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
  playBtn: css`
    margin: 8px auto 0;
    padding: 10px 22px;
    font-size: 16px;
    font-weight: 600;
    color: ${theme.colors.primary.contrastText};
    background: ${theme.colors.primary.main};
    border: none;
    border-radius: ${theme.shape.radius.default};
    cursor: pointer;
    pointer-events: auto;
    &:hover {
      background: ${theme.colors.primary.shade};
    }
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

