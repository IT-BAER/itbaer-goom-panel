import { engineWindowArgs } from '../engine';

describe('engineWindowArgs', () => {
  const px = (args: string[]) => ({ w: Number(args[1]), h: Number(args[3]) });

  it('asks for a window that lands on the exact backbuffer after the DPR multiply', () => {
    // scale 325 at DPR 1.25 -> 1040x780 device pixels, the 4:3 grid the engine renders
    const { w, h } = px(engineWindowArgs(325, 1.25));
    expect(w * 1.25).toBe(1040);
    expect(h * 1.25).toBe(780);
  });

  it('keeps 4:3 across scales and DPRs', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const scale of [100, 200, 325, 500]) {
        const { w, h } = px(engineWindowArgs(scale, dpr));
        expect(w / h).toBeCloseTo(4 / 3, 2);
      }
    }
  });

  it('clamps junk input instead of emitting a degenerate window', () => {
    const { w, h } = px(engineWindowArgs(NaN, 0));
    expect(w).toBeGreaterThanOrEqual(320);
    expect(h).toBeGreaterThanOrEqual(240);
  });
});
