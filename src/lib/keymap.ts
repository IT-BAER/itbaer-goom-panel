/**
 * Keyboard mapping layer. Converts browser KeyboardEvent codes into the DOOM
 * engine's expected key codes (chocolate-doom / id Tech 1). We don't modify
 * the engine itself; we translate keys via a pass-through overlay and dispatch
 * native-like events into the canvas.
 *
 * In v1 we simply relay key events to the Emscripten-backed canvas (SDL2
 * picks them up when the canvas has focus). The presets here control which
 * browser keys produce the engine's movement/use/fire keys.
 */
import type { ControlPreset } from '../types';

export type EngineAction =
  | 'forward'
  | 'back'
  | 'strafeLeft'
  | 'strafeRight'
  | 'turnLeft'
  | 'turnRight'
  | 'fire'
  | 'use'
  | 'menu'
  | 'map';

/** Map from `KeyboardEvent.code` → engine action. */
export type Keymap = Readonly<Partial<Record<string, EngineAction>>>;

export const WASD_KEYMAP: Keymap = Object.freeze({
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'strafeLeft',
  KeyD: 'strafeRight',
  KeyQ: 'turnLeft',
  KeyE: 'use',
  ArrowLeft: 'turnLeft',
  ArrowRight: 'turnRight',
  Space: 'fire',
  Backspace: 'menu',
  KeyM: 'map',
});

export const VANILLA_KEYMAP: Keymap = Object.freeze({
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'turnLeft',
  ArrowRight: 'turnRight',
  ControlLeft: 'fire',
  Space: 'use',
  Escape: 'menu',
  Tab: 'map',
});

export function getKeymap(preset: ControlPreset): Keymap {
  return preset === 'wasd' ? WASD_KEYMAP : VANILLA_KEYMAP;
}
