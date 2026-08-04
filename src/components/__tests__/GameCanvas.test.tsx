import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GameCanvas, fitPreferredCanvasBox } from '../GameCanvas';
import { defaultGoomOptions } from '../../types';
import { startEngine, primeEngineAudioContext } from '../../lib/engine';
import { resolveWad } from '../../lib/resolveWad';

jest.mock('@grafana/ui', () => ({
  useStyles2: () =>
    new Proxy(
      {},
      {
        get: (_target, key) => String(key),
      }
    ),
}));

jest.mock('../../lib/engine', () => ({
  primeEngineAudioContext: jest.fn(),
  startEngine: jest.fn(),
  setEngineMuted: jest.fn(),
  resumeEngineAudio: jest.fn(),
  getEngineCanvas: jest.fn(() => document.createElement('canvas')),
  parkEngineCanvas: jest.fn(),
}));

jest.mock('../../lib/resolveWad', () => ({
  resolveWad: jest.fn(),
}));

jest.mock('../Hud', () => ({
  Hud: () => null,
}));

const mockedStartEngine = jest.mocked(startEngine);
const mockedPrimeEngineAudioContext = jest.mocked(primeEngineAudioContext);
const mockedResolveWad = jest.mocked(resolveWad);

const resolvedWad = {
  bytes: new Uint8Array([0, 1, 2, 3]).buffer,
  name: 'freedoom1.wad',
  sha: 'deadbeef',
  source: 'freedoom' as const,
};

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  global.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
  global.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof requestAnimationFrame;
  global.cancelAnimationFrame = jest.fn() as typeof cancelAnimationFrame;
});

beforeEach(() => {
  mockedPrimeEngineAudioContext.mockReset();
  mockedResolveWad.mockReset();
  mockedStartEngine.mockReset();

  mockedResolveWad.mockResolvedValue(resolvedWad);
});

it('passes gameScale into manual play boot', async () => {
  mockedStartEngine.mockResolvedValue({
    live: true,
    dispose: jest.fn(),
  });

  render(
    <GameCanvas
      options={{
        ...defaultGoomOptions,
        autoStart: false,
        gameScale: 325,
      }}
      width={1200}
      height={900}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /play/i }));

  await waitFor(() => {
    expect(mockedStartEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        gameScale: 325,
      })
    );
  });
});

// The engine is a per-page singleton, so a live engine is never torn down for an
// option change: gameScale only takes effect on the next page load.
it('keeps the running engine when gameScale changes', async () => {
  const dispose = jest.fn();

  mockedStartEngine.mockResolvedValue({
    live: true,
    dispose,
  });

  const { rerender } = render(
    <GameCanvas
      options={{
        ...defaultGoomOptions,
        autoStart: false,
        gameScale: 200,
      }}
      width={1200}
      height={900}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /play/i }));

  await waitFor(() => {
    expect(mockedStartEngine).toHaveBeenCalledTimes(1);
  });

  rerender(
    <GameCanvas
      options={{
        ...defaultGoomOptions,
        autoStart: false,
        gameScale: 350,
      }}
      width={1200}
      height={900}
    />
  );

  await waitFor(() => {
    expect(dispose).not.toHaveBeenCalled();
    expect(mockedStartEngine).toHaveBeenCalledTimes(1);
  });
});

describe('fitPreferredCanvasBox', () => {
  const fits = (w: number, h: number) => {
    const box = fitPreferredCanvasBox(320, 240, w, h);
    return { ...box, aspect: box.width / box.height, insideW: box.width <= w, insideH: box.height <= h };
  };

  it('never overflows the panel on either axis and keeps 4:3', () => {
    // wide+short, narrow+tall, square, and exact-fit panels
    for (const [w, h] of [[1600, 400], [300, 900], [500, 500], [800, 600]]) {
      const box = fits(w, h);
      expect(box.insideW).toBe(true);
      expect(box.insideH).toBe(true);
      expect(box.aspect).toBeCloseTo(4 / 3, 1);
    }
  });

  it('is width-bound on a narrow panel and height-bound on a short one', () => {
    expect(fits(300, 900).width).toBe(300);
    expect(fits(1600, 400).height).toBe(400);
  });
});
