import { expect, test } from '@playwright/test';
import { at, freshStart, setValue, shot, tap, tapGrid } from './helpers';

test.beforeEach(async ({ page }) => freshStart(page));

const flowSpeeds = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).app.board.flows.map((f: { speed: number }) => Math.abs(f.speed)));

test('dots move along the wires at a speed proportional to the current', async ({ page }) => {
  const line = page.locator('.flow.on').first();
  await expect(line).toBeAttached();
  const before = await line.evaluate((l: SVGLineElement) => l.style.strokeDashoffset);
  await page.waitForTimeout(300);
  const after = await line.evaluate((l: SVGLineElement) => l.style.strokeDashoffset);
  expect(after).not.toBe(before);

  // 20 mA: 60 px/s on every wire of the single loop.
  const speeds = await flowSpeeds(page);
  expect(speeds.length).toBeGreaterThan(0);
  for (const s of speeds) expect(s).toBeCloseTo(60, 3);

  // With 720 Ω the current is about half, and so is the speed.
  await setValue(page, { x: 3, y: -3 }, '720');
  const slower = await flowSpeeds(page);
  expect(slower[0]).toBeGreaterThan(25);
  expect(slower[0]).toBeLessThan(35);
});

test('an LED over 30 mA burns and can be replaced', async ({ page }, info) => {
  await expect(page.locator('.element.led .glow')).toHaveAttribute('opacity', /^0\.5/);
  await setValue(page, { x: 3, y: -3 }, '100');
  await expect(page.locator('.status')).toContainText('O LED D1 queimou');
  await expect(page.locator('.element.led .burnt')).toBeAttached();
  await expect(page.locator('.flow.on')).toHaveCount(0);
  await shot(page, info, 'burnt');

  // Back to 360 Ω: the LED stays burnt until it is replaced.
  await setValue(page, { x: 3, y: -3 }, '360');
  await expect(page.locator('.element.led .burnt')).toBeAttached();
  await tapGrid(page, { x: 6, y: 0 });
  await page.locator('.panel [data-action=repair]').click();
  await expect(page.locator('.element.led .burnt')).toHaveCount(0);
  await expect(page.locator('.status')).toBeHidden();
});

test('pointing at a component shows V, I and P', async ({ page }, info) => {
  const r1 = await at(page, { x: 3, y: -3 });
  if (info.project.name === 'desktop') await page.mouse.move(r1.x, r1.y);
  else await tap(page, r1);
  const tooltip = page.locator('.tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('R1');
  await expect(tooltip).toContainText('V = 7,2 V');
  await expect(tooltip).toContainText('I = 20 mA');
  await expect(tooltip).toContainText('P = 144 mW');
  await shot(page, info, 'tooltip');

  // The LED.
  const d1 = await at(page, { x: 6, y: 0 });
  if (info.project.name === 'desktop') await page.mouse.move(d1.x, d1.y);
  else await tap(page, d1);
  await expect(tooltip).toContainText('V = 1,8 V');
});

test('a lamp glows more with more current', async ({ page }) => {
  const opacity = () => page.locator('.element.lamp .glow').getAttribute('opacity').then(Number);
  // Swap the LED for a lamp rated 9 V: 9 V on 360 + 30 Ω is well below rated current.
  await page.evaluate(() => {
    const app = (window as any).app;
    const c = app.history.present;
    app.commit({
      ...c,
      elements: c.elements.map((e: any) => (e.kind === 'led' ? { ...e, kind: 'lamp', name: 'L1', value: 30, rated: 9 } : e)),
    });
  });
  const dim = await opacity();
  await setValue(page, { x: 3, y: -3 }, '10');
  const bright = await opacity();
  expect(bright).toBeGreaterThan(dim);
});
