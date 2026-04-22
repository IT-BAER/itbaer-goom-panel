import { test, expect } from '@grafana/plugin-e2e';

/**
 * Matrix e2e: open each panel variant in panel-edit mode and verify the
 * engine reaches the expected state. Panel-edit shows one panel at a time,
 * so the page-level singleton guard does not cross-fire between cases.
 */

type Expectation = 'running' | 'loading-only' | 'error' | 'no-hard-error';

interface Case {
  id: string;
  label: string;
  expect: Expectation;
}

const cases: Case[] = [
  { id: '10', label: 'freedoom / wasd / mute / autoStart', expect: 'running' },
  { id: '11', label: 'freedoom / vanilla / mute / autoStart', expect: 'running' },
  // Unmuted autoplay is blocked by the browser autoplay policy until a user
  // gesture; the engine may stay in the loading overlay until audio is
  // unlocked. We only verify no hard engine error here.
  { id: '12', label: 'freedoom / wasd / unmuted / autoStart', expect: 'no-hard-error' },
  { id: '13', label: 'freedoom / wasd / mute / autoStart=false', expect: 'loading-only' },
  { id: '14', label: 'url / localhost freedoom / autoStart', expect: 'running' },
  { id: '15', label: 'url / 404 (expected error)', expect: 'error' },
];

for (const c of cases) {
  test(`matrix[${c.id}] ${c.label} → ${c.expect}`, async ({
    gotoPanelEditPage,
    readProvisionedDashboard,
  }) => {
    const dashboard = await readProvisionedDashboard({ fileName: 'matrix.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: c.id });
    const panel = panelEditPage.panel.locator;
    await expect(panel).toBeVisible();

    // Canvas element always renders, even for loading / error states.
    const canvas = panel.locator('canvas');
    await expect(canvas).toHaveCount(1, { timeout: 15_000 });

    if (c.expect === 'running') {
      // Click the canvas to satisfy the browser autoplay policy (required
      // for unmuted cases — without a user gesture, AudioContext stays
      // suspended and SDL2's audio init can stall the emscripten main loop).
      await canvas.click({ position: { x: 20, y: 20 } }).catch(() => {});
      // The overlay disappears once status flips to 'running'.
      // GameCanvas gives the glue 800ms to init before marking running.
      await expect(panel.getByText('Engine failed to start')).toHaveCount(0);
      await expect(panel.getByText('Loading Goom…')).toHaveCount(0, { timeout: 25_000 });
    } else if (c.expect === 'loading-only') {
      // autoStart=false keeps the overlay at "Loading Goom…" (no engine boot).
      await expect(panel.getByText('Loading Goom…')).toBeVisible();
      await expect(panel.getByText('Engine failed to start')).toHaveCount(0);
    } else if (c.expect === 'no-hard-error') {
      // Autoplay-blocked scenarios: canvas present, no error overlay. The
      // engine may stay in "Loading Goom…" until a user gesture unlocks audio.
      await expect(panel.getByText('Engine failed to start')).toHaveCount(0);
    } else {
      // Expected hard error (bad URL etc.).
      await expect(panel.getByText('Engine failed to start')).toBeVisible({ timeout: 15_000 });
    }
  });
}
