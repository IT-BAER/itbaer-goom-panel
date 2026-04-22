import { test, expect } from '@grafana/plugin-e2e';

/**
 * Smoke: a Goom panel in the provisioned dashboard boots and displays either
 * the running game canvas or a loading overlay. We don't require the canvas
 * to be rendering a specific frame — Emscripten + Freedoom loading is async
 * and target runners vary in speed.
 */
test('Goom panel mounts and shows the game canvas', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });
  await expect(panelEditPage.panel.locator).toBeVisible();
  // Either the running canvas or the loading overlay must be present.
  const panel = panelEditPage.panel.locator;
  const canvas = panel.locator('canvas');
  await expect(canvas).toHaveCount(1, { timeout: 15_000 });
  // Panel should not surface a hard error overlay.
  await expect(panel.getByText('Engine failed to start')).toHaveCount(0);
});
