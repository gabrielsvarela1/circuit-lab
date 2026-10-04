import { expect, type Page, test } from '@playwright/test';
import { at, drag, freshStart, setValue, shot, tapGrid, wire } from './helpers';

test.beforeEach(async ({ page }) => freshStart(page));

async function loadExample(page: Page, title: string) {
  await page.click('[data-cmd=examples]');
  await page.locator('dialog.examples .example-list button', { hasText: title }).click();
}

const camera = (page: Page) => page.evaluate(() => ({ ...(window as any).app.board.camera }));
const wireCount = (page: Page) => page.evaluate(() => (window as any).app.history.present.wires.length);

test('AC: the dots change direction and each LED lights in its half-cycle', async ({ page }, info) => {
  await loadExample(page, 'Corrente alternada e dois LEDs');
  await expect(page.locator('.note')).toContainText('Corrente alternada a 1 Hz');

  // Sample for a little over one period (1 s at 1 Hz).
  const seen = { forward: false, backward: false, d1: 0, d2: 0 };
  for (let k = 0; k < 14; k++) {
    const s = await page.evaluate(() => {
      const app = (window as any).app;
      const glow = (name: string) => {
        const e = app.history.present.elements.find((x: any) => x.name === name);
        return Number(document.querySelector(`[data-id="${e.id}"] .glow`)!.getAttribute('opacity'));
      };
      return { speeds: app.board.flows.map((f: any) => f.speed), d1: glow('D1'), d2: glow('D2') };
    });
    if (s.speeds.some((v: number) => v > 0)) seen.forward = true;
    if (s.speeds.some((v: number) => v < 0)) seen.backward = true;
    seen.d1 = Math.max(seen.d1, s.d1);
    seen.d2 = Math.max(seen.d2, s.d2);
    if (k === 3) await shot(page, info, 'ac');
    await page.waitForTimeout(90);
  }
  expect(seen.forward && seen.backward).toBe(true);
  expect(seen.d1).toBeGreaterThan(0.3);
  expect(seen.d2).toBeGreaterThan(0.3);

  // RMS readings in the panel.
  await tapGrid(page, { x: 3, y: -3 });
  await expect(page.locator('.panel .readings')).toContainText('Corrente eficaz');

  // At 50 Hz the animation runs in slow motion.
  await setValue(page, { x: 0, y: 0 }, '50', 1);
  await expect(page.locator('.note')).toContainText('câmara lenta a 1 Hz');
});

test('internal resistance: 8 V at the terminals, and a warning instead of an ideal short', async ({ page }, info) => {
  await loadExample(page, 'Pilha com resistência interna');
  await expect(page.locator('.reading')).toHaveText('8 V');
  await tapGrid(page, { x: 0, y: 0 });
  await expect(page.locator('.panel input[data-prop=r]')).toHaveValue('1');

  // A wire across the battery: 9 V / 1 Ω = 9 A, not infinite.
  await wire(page, { x: -3, y: -1 }, { x: -3, y: 1 });
  await expect(page.locator('.status')).toContainText('Corrente muito elevada em E1 (9 A)');
  await shot(page, info, 'high-current');

  // With r = 0 it becomes an ideal short circuit again.
  await setValue(page, { x: 0, y: 0 }, '0', 1);
  await expect(page.locator('.status')).toContainText('Curto-circuito');
});

test('a lamp above 1,5 times its rated current blows and can be replaced', async ({ page }) => {
  await loadExample(page, 'Lâmpadas em paralelo');
  await setValue(page, { x: 0, y: 0 }, '18');
  await expect(page.locator('.status')).toContainText('fundiu');
  await setValue(page, { x: 0, y: 0 }, '9');
  await tapGrid(page, { x: 4, y: 1 });
  await expect(page.locator('.panel')).toContainText('Esta lâmpada fundiu');
  await page.locator('.panel [data-action=repair]').click();
  await expect(page.locator('.panel')).not.toContainText('Esta lâmpada fundiu');
  await expect(page.locator('.panel .readings')).toContainText('300 mA');
});

test('dragging the end of a selected wire moves it', async ({ page }) => {
  // Bottom wire of the default circuit, from (6,3) to (0,3).
  await tapGrid(page, { x: 3, y: 3 });
  await expect(page.locator('.handle')).toHaveCount(2);
  await drag(page, await at(page, { x: 0, y: 3 }), await at(page, { x: 3, y: 5 }));
  // The wire no longer reaches the battery.
  await expect(page.locator('.status')).toContainText('Circuito aberto');
  await page.click('[data-cmd=undo]');
  await expect(page.locator('.status')).toBeHidden();
});

test('"Mover vista" pans with one finger or the mouse instead of drawing', async ({ page }) => {
  const before = await camera(page);
  const wires = await wireCount(page);
  await page.click('[data-cmd=pan]');
  await expect(page.locator('[data-cmd=pan]')).toHaveAttribute('aria-pressed', 'true');
  await drag(page, await at(page, { x: 2, y: 1 }), await at(page, { x: 4, y: 2 }));
  const after = await camera(page);
  expect(after.x).toBeGreaterThan(before.x + 30);
  expect(await wireCount(page)).toBe(wires);

  // A tap still selects.
  await tapGrid(page, { x: 3, y: -3 });
  await expect(page.locator('.panel h2')).toContainText('R1');
});

test('space and drag moves the view with the mouse', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard and mouse only');
  const before = await camera(page);
  const wires = await wireCount(page);
  await page.keyboard.down(' ');
  await drag(page, await at(page, { x: 2, y: 1 }), await at(page, { x: 4, y: 2 }));
  await page.keyboard.up(' ');
  expect((await camera(page)).x).toBeGreaterThan(before.x + 30);
  expect(await wireCount(page)).toBe(wires);
});

test('the circuit can be built and edited with the keyboard only', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard only');
  // Tab from the last palette button into the grid; the cursor starts at (0,0), on E1.
  await page.locator('.tool').last().focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.board')).toBeFocused();
  await expect(page.locator('.kb-cursor').first()).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.sr-status')).toContainText('Cursor em 0, 0: E1, Pilha');

  // Move to R1 at (3,-3), select it and move it up one cell with Shift+arrow.
  for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowUp']) await page.keyboard.press(k);
  await page.keyboard.press(' ');
  await expect(page.locator('.panel h2')).toContainText('R1');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(page.locator('.panel .readings')).toContainText('20 mA');
  expect(await page.evaluate(() => (window as any).app.history.present.elements.find((e: any) => e.name === 'R1').y)).toBe(-4);

  // Draw a wire around the battery: (0,-1) to (-2,1), then to (0,1).
  for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowDown']) await page.keyboard.press(k);
  await expect(page.locator('.sr-status')).toContainText('Cursor em 0, -1');
  await page.keyboard.press('Enter');
  for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown']) await page.keyboard.press(k);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.status')).toContainText('Curto-circuito');
  await shot(page, info, 'keyboard');
});

test('dark theme follows the toggle and is remembered', async ({ page }, info) => {
  await page.click('[data-cmd=theme]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(18, 22, 28)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-cmd=theme]')).toHaveText('Tema claro');
  await loadExample(page, 'Três LEDs');
  await shot(page, info, 'dark');
  await page.click('[data-cmd=theme]');
  expect(await bg()).toBe('rgb(244, 245, 247)');
});
