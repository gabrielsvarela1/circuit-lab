import { expect, type Page, test } from '@playwright/test';
import { freshStart, shot, tapGrid } from './helpers';

test.beforeEach(async ({ page }) => freshStart(page));

async function loadExample(page: Page, title: string) {
  await page.click('[data-cmd=examples]');
  await page.locator('dialog.examples .example-list button', { hasText: title }).click();
  await expect(page.locator('dialog.examples')).not.toBeVisible();
}

test('examples load with one click and show the expected readings', async ({ page }, info) => {
  await page.click('[data-cmd=examples]');
  await expect(page.locator('dialog.examples .example-list button')).toHaveCount(9);
  await shot(page, info, 'examples');
  await page.click('[data-cmd=close-examples]');

  await loadExample(page, 'Ponte de Wheatstone');
  await expect(page.locator('.reading')).toHaveText('0 A');

  await loadExample(page, 'Divisor de tensão');
  await expect(page.locator('.reading')).toHaveText('8 V');

  await loadExample(page, 'Série com amperímetro');
  await expect(page.locator('.reading').first()).toHaveText('30 mA');
  await expect(page.locator('.reading').nth(1)).toHaveText('6 V');

  // Lamps in parallel: closing S3 doubles the battery current (0,3 A to 0,6 A).
  await loadExample(page, 'Lâmpadas em paralelo');
  await tapGrid(page, { x: 1, y: 0 });
  await page.waitForTimeout(50);
  const battery = () => page.evaluate(() => {
    const app = (window as any).app;
    const e = app.history.present.elements.find((x: any) => x.name === 'E1');
    return Math.abs(app.result.parts.get(e.id).i);
  });
  expect(await battery()).toBeCloseTo(0.3, 6);
  await tapGrid(page, { x: 7, y: -2 });
  expect(await battery()).toBeCloseTo(0.6, 6);

  await loadExample(page, 'Três LEDs');
  await expect(page.locator('.status')).toBeHidden();
  await shot(page, info, 'three-leds');
});

test('an exercise hides the values until the right answer', async ({ page }, info) => {
  await page.click('[data-cmd=exercises]');
  await expect(page.locator('.ex-list li')).toHaveCount(8);
  await page.locator('.ex-list button', { hasText: 'Lei de Ohm' }).click();
  await expect(page.locator('.exercise h2')).toHaveText('Lei de Ohm');

  // Values are hidden.
  await tapGrid(page, { x: 3, y: -3 });
  await expect(page.locator('.panel')).toContainText('Os valores ficam escondidos');

  const answer = page.locator('#answer');
  await answer.fill('25');
  await answer.press('Enter');
  await expect(page.locator('.feedback')).toContainText('Ainda não');
  await expect(page.locator('.feedback')).toContainText('Dica');
  await shot(page, info, 'exercise-wrong');

  await answer.fill('30');
  await page.locator('.answer button[type=submit]').click();
  await expect(page.locator('.feedback')).toContainText('Certo');
  await expect(page.locator('.solution')).toBeVisible();
  await expect(page.locator('.panel .readings')).toContainText('30 mA');
  await shot(page, info, 'exercise-right');

  // Progress is remembered in the list.
  await page.locator('[data-ex=list]').click();
  await expect(page.locator('.ex-list li').first()).toContainText('Resolvido');
});

test('design exercises are checked by the simulator', async ({ page }) => {
  await page.click('[data-cmd=exercises]');
  await page.locator('.ex-list button', { hasText: 'Resistência para um LED' }).click();
  const answer = page.locator('#answer');
  await answer.fill('330');
  await answer.press('Enter');
  await expect(page.locator('.feedback')).toContainText('Com R1 = 330 Ω o LED fica com 21,8 mA.');
  await answer.fill('360');
  await answer.press('Enter');
  await expect(page.locator('.feedback')).toContainText('Certo');
  await expect(page.locator('.board .label', { hasText: 'R1' })).toContainText('360 Ω');

  await page.locator('[data-ex=next]').click();
  await page.locator('[data-ex=next]').click();
  await expect(page.locator('.exercise h2')).toHaveText('Ponte de Wheatstone');
  await expect(page.locator('.reading')).toHaveText('?');
  await answer.fill('300 Ω');
  await answer.press('Enter');
  await expect(page.locator('.feedback')).toContainText('Certo');
  await expect(page.locator('.reading')).toHaveText('0 A');
});

test('answers can include units, and the solution can be revealed', async ({ page }) => {
  await page.click('[data-cmd=exercises]');
  await page.locator('.ex-list button', { hasText: 'Leis de Kirchhoff' }).click();
  await page.locator('#answer').fill('0,015 A');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('.feedback')).toContainText('Certo');

  await page.locator('[data-ex=prev]').click();
  await page.locator('[data-ex=solution]').click();
  await expect(page.locator('.solution')).toContainText('360 Ω');

  await page.locator('[data-ex=list]').click();
  await page.locator('[data-ex=close]').click();
  await expect(page.locator('.exercise')).toBeHidden();
});
