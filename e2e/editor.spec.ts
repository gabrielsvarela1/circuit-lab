import { expect, test } from '@playwright/test';
import { at, drag, drop, freshStart, setValue, shot, tapGrid, wire } from './helpers';

test.beforeEach(async ({ page }) => freshStart(page));

test('the default circuit runs the LED at 20 mA', async ({ page }, info) => {
  await tapGrid(page, { x: 3, y: -3 });
  await expect(page.locator('.panel h2')).toContainText('R1');
  await expect(page.locator('.panel .readings')).toContainText('20 mA');
  await expect(page.locator('.panel .readings')).toContainText('7,2 V');
  await shot(page, info, 'default');
});

test('build a series circuit, edit values, undo and redo', async ({ page }, info) => {
  await page.click('[data-cmd=clear]');
  await page.click('[data-cmd=fit]');
  await expect(page.locator('.board .element')).toHaveCount(0);

  // E1 vertical at (-3,0): + at (-3,-1), - at (-3,1).
  await drop(page, 'battery', { x: -3, y: 0 });
  await drop(page, 'resistor', { x: -1, y: -2 });
  await drop(page, 'resistor', { x: 1, y: 0 });
  await page.locator('.panel [data-action=rotate]').click();
  await drop(page, 'ammeter', { x: -1, y: 2 });
  await drop(page, 'voltmeter', { x: 3, y: 0 });
  await page.locator('.panel [data-action=rotate]').click();
  await expect(page.locator('.board .element')).toHaveCount(5);

  await wire(page, { x: -3, y: -1 }, { x: -3, y: -2 });
  await wire(page, { x: -3, y: -2 }, { x: -2, y: -2 });
  await wire(page, { x: 0, y: -2 }, { x: 1, y: -2 });
  await wire(page, { x: 1, y: -2 }, { x: 1, y: -1 });
  await wire(page, { x: 1, y: 1 }, { x: 1, y: 2 });
  await wire(page, { x: 1, y: 2 }, { x: 0, y: 2 });
  await wire(page, { x: -2, y: 2 }, { x: -3, y: 2 });
  await wire(page, { x: -3, y: 2 }, { x: -3, y: 1 });
  await wire(page, { x: 1, y: -1 }, { x: 3, y: -1 });
  await wire(page, { x: 1, y: 1 }, { x: 3, y: 1 });

  // 9 V over 100 Ω + 100 Ω.
  const ammeter = page.locator('.reading').first();
  await expect(ammeter).toHaveText(/^-?45 mA$/);

  // R2 = 200 Ω: 9 / 300 = 30 mA, and 6 V across R2.
  await setValue(page, { x: 1, y: 0 }, '200');
  await expect(ammeter).toHaveText(/^-?30 mA$/);
  await expect(page.locator('.reading').nth(1)).toHaveText('6 V');
  await shot(page, info, 'series');

  await page.click('[data-cmd=undo]');
  await expect(ammeter).toHaveText(/^-?45 mA$/);
  await page.click('[data-cmd=redo]');
  await expect(ammeter).toHaveText(/^-?30 mA$/);

  // "1k" is accepted: 9 / 1200 = 7,5 mA.
  await setValue(page, { x: -1, y: -2 }, '1k');
  await expect(ammeter).toHaveText(/^-?7,5 mA$/);
  await setValue(page, { x: -1, y: -2 }, 'abc');
  await expect(page.locator('.panel .error')).toBeVisible();

  // Deleting the ammeter opens the circuit.
  await tapGrid(page, { x: -1, y: 2 });
  await page.locator('.panel [data-action=remove]').click();
  await expect(page.locator('.status')).toContainText('Circuito aberto');
  await page.click('[data-cmd=undo]');
  await expect(page.locator('.status')).toBeHidden();

  // A wire around the battery is a short circuit.
  await wire(page, { x: -3, y: -1 }, { x: -4, y: -1 });
  await wire(page, { x: -4, y: -1 }, { x: -4, y: 1 });
  await wire(page, { x: -4, y: 1 }, { x: -3, y: 1 });
  await expect(page.locator('.status')).toContainText('Curto-circuito');
  await shot(page, info, 'short');
});

test('moving a component keeps its wires attached', async ({ page }) => {
  await drag(page, await at(page, { x: 3, y: -3 }), await at(page, { x: 3, y: -4 }));
  await tapGrid(page, { x: 3, y: -4 });
  await expect(page.locator('.panel h2')).toContainText('R1');
  await expect(page.locator('.panel .readings')).toContainText('20 mA');
});

test('the switch opens and closes the circuit', async ({ page }) => {
  await page.click('[data-cmd=clear]');
  await drop(page, 'battery', { x: 0, y: 0 });
  await drop(page, 'switch', { x: 3, y: -2 });
  await drop(page, 'lamp', { x: 3, y: 2 });
  await wire(page, { x: 0, y: -1 }, { x: 2, y: -2 });
  await wire(page, { x: 4, y: -2 }, { x: 4, y: 2 });
  await wire(page, { x: 2, y: 2 }, { x: 0, y: 1 });
  await expect(page.locator('.status')).toContainText('Circuito aberto');
  await tapGrid(page, { x: 3, y: -2 });
  await expect(page.locator('.status')).toBeHidden();
  await tapGrid(page, { x: 3, y: 2 });
  // 9 V on a 30 Ω lamp.
  await expect(page.locator('.panel .readings')).toContainText('300 mA');
});

test('the circuit survives a reload and can be shared by URL', async ({ page, browser }, info) => {
  await setValue(page, { x: 3, y: -3 }, '470');
  await page.reload();
  await tapGrid(page, { x: 3, y: -3 });
  await expect(page.locator('.panel input[data-prop=value]')).toHaveValue('470');

  // Open the link in a separate browser profile, with empty storage.
  const link = await page.evaluate(() => (window as any).app.link());
  const context = await browser.newContext(info.project.use);
  const other = await context.newPage();
  await other.goto(link);
  await other.waitForSelector('.board .element');
  await tapGrid(other, { x: 3, y: -3 });
  await expect(other.locator('.panel input[data-prop=value]')).toHaveValue('470');
  expect(other.url()).not.toContain('#c=');
  await context.close();
});

test('a wire can be selected and deleted', async ({ page }) => {
  // The bottom wire of the default circuit runs from (6,3) to (0,3).
  await tapGrid(page, { x: 3, y: 3 });
  await expect(page.locator('.panel h2')).toHaveText('Fio');
  await expect(page.locator('.panel .readings')).toContainText('20 mA');
  await page.locator('.panel [data-action=remove]').click();
  await expect(page.locator('.status')).toContainText('Circuito aberto');
});

test('two fingers zoom the view on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch only');
  const scale = () => page.evaluate(() => (window as any).app.board.camera.scale);
  const before = await scale();
  const box = (await page.locator('.board').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const fingers = (d: number) => [
    { x: cx - d, y: cy, id: 0 },
    { x: cx + d, y: cy, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40) });
  for (let d = 45; d <= 100; d += 5) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await scale()).toBeGreaterThan(before * 1.5);
  // Pinching must not move or add anything.
  await expect(page.locator('.board .element')).toHaveCount(3);
  await expect(page.locator('.board .wire')).toHaveCount(7);
});
