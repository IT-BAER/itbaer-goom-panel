import { test, expect } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';

/**
 * Matrix e2e: open each panel variant in panel-edit mode and verify the
 * engine reaches the expected state. Panel-edit shows one panel at a time,
 * so the page-level singleton guard does not cross-fire between cases.
 */

type Expectation = 'running' | 'idle-only' | 'error' | 'no-hard-error';

/**
 * Fail with the panel's own error text rather than a bare count assertion.
 * The overlay renders `errMsg` in a <pre>, which is the only place the real
 * boot failure is reported; without this a CI failure says nothing usable.
 */
async function expectNoEngineError(panel: Locator) {
  const error = panel.getByText('Engine failed to start');
  if ((await error.count()) > 0) {
    const detail = await panel
      .locator('pre')
      .first()
      .innerText()
      .catch(() => '(no detail rendered)');
    throw new Error(`Engine failed to start. Panel reported: ${detail}`);
  }
}

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
  { id: '13', label: 'freedoom / wasd / mute / autoStart=false', expect: 'idle-only' },
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
      await expectNoEngineError(panel);
      await expect(panel.getByText('Loading Goom…')).toHaveCount(0, { timeout: 25_000 });
    } else if (c.expect === 'idle-only') {
      // autoStart=false leaves status at 'idle', which renders the Play prompt.
      // It never passes through 'loading' until the user clicks Play.
      await expect(panel.getByText('Click play to load Freedoom and start the engine.')).toBeVisible();
      await expectNoEngineError(panel);
    } else if (c.expect === 'no-hard-error') {
      // Autoplay-blocked scenarios: canvas present, no error overlay. The
      // engine may stay in "Loading Goom…" until a user gesture unlocks audio.
      await expectNoEngineError(panel);
    } else {
      // Expected hard error (bad URL etc.).
      await expect(panel.getByText('Engine failed to start')).toBeVisible({ timeout: 15_000 });
    }
  });
}
