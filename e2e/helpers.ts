import type { Page, TestInfo } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}

const isPhone = (page: Page) => page.viewportSize()!.width < 600;

/** Client coordinates of a grid point. */
export function at(page: Page, p: Point): Promise<Point> {
  return page.evaluate((q) => (window as any).app.board.toClient(q), p);
}

/** Drags with the mouse, or with one finger on phones. */
export async function drag(page: Page, from: Point, to: Point, steps = 10): Promise<void> {
  if (isPhone(page)) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let k = 1; k <= steps; k++) {
      const x = from.x + ((to.x - from.x) * k) / steps;
      const y = from.y + ((to.y - from.y) * k) / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    return;
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= steps; k++) {
    await page.mouse.move(from.x + ((to.x - from.x) * k) / steps, from.y + ((to.y - from.y) * k) / steps);
  }
  await page.mouse.up();
}

/** Taps or clicks a client point. */
export async function tap(page: Page, p: Point): Promise<void> {
  if (isPhone(page)) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

export async function tapGrid(page: Page, p: Point): Promise<void> {
  await tap(page, await at(page, p));
}

/** Draws a wire between two grid points. */
export async function wire(page: Page, from: Point, to: Point): Promise<void> {
  await drag(page, await at(page, from), await at(page, to));
}

/** Drags a component from the palette to a grid point. */
export async function drop(page: Page, kind: string, p: Point): Promise<void> {
  const box = (await page.locator(`.tool[data-kind=${kind}]`).boundingBox())!;
  await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, await at(page, p), 14);
}

/** Selects an element and sets a value through the panel. */
export async function setValue(page: Page, p: Point, value: string, field = 0): Promise<void> {
  await tapGrid(page, p);
  const input = page.locator('.panel input[data-prop]').nth(field);
  await input.fill(value);
  await input.press('Enter');
}

export async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  await page.screenshot({ path: `test-results/shots/${info.project.name}-${name}.png`, fullPage });
}

export async function freshStart(page: Page, path = './'): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
  await page.waitForSelector('.board .element');
}
