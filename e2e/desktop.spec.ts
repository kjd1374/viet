import { expect, test } from '@playwright/test';
import { decisions, dismissGuide, mouseSwipe, open, SHOTS, topId } from './helpers';

test('데스크톱: 마우스 드래그·클릭·키보드가 같은 경로로 동작', async ({ page }) => {
  await open(page);
  await dismissGuide(page);
  await page.screenshot({ path: `${SHOTS}/20-desktop.png` });

  await mouseSwipe(page, 220, 0);
  await expect.poll(() => topId(page)).toBe('p002');

  await page.getByRole('navigation', { name: '결정' }).getByRole('button', { name: '삭제' }).click();
  await expect.poll(() => topId(page)).toBe('p003');

  await page.waitForTimeout(320);
  await page.keyboard.press('ArrowDown'); // 보류
  await expect.poll(() => topId(page)).toBe('p004');

  await page.keyboard.press('ArrowUp'); // 구매 정보
  await expect(page.getByTestId('sheet')).toHaveAttribute('data-product-id', 'p004');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('sheet')).toHaveCount(0);

  await page.waitForTimeout(320);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => topId(page)).toBe('p005');
  await page.keyboard.press('z'); // 되돌리기
  await expect.poll(() => topId(page)).toBe('p004');

  expect(await decisions(page)).toEqual({ p001: 'saved', p002: 'deleted', p003: 'held', p004: 'unseen' });
});
