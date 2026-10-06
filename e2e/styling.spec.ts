import { expect, test, type Page } from '@playwright/test';
import { dismissGuide, open, SHOTS } from './helpers';

const SAVE = ['p001', 'p002', 'p007', 'p008', 'p009', 'p004', 'p005', 'p006'];

async function setup(page: Page) {
  await open(page);
  await dismissGuide(page, true);
  // 스와이프 자체는 mobile.spec에서 검증했으므로 여기서는 같은 단일 경로(commit)로 빠르게 보관한다
  await page.evaluate((ids) => ids.forEach((id) => (window as any).__store.commit(id, 'saved', { expect: ['unseen'] })), SAVE);
  await page.getByRole('button', { name: /보관함 8개/ }).click();
  await page.getByRole('button', { name: /보관한 옷으로 코디하기/ }).click();
  await expect(page.getByTestId('fit-canvas')).toBeVisible();
}

const layers = (page: Page) =>
  page.locator('[data-testid=fit-canvas] img').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-slot')}:${e.getAttribute('data-product-id') ?? ''}`));

const tab = (page: Page, name: string) => page.getByRole('tab', { name: new RegExp(`^${name}`) });
const pick = (page: Page, id: string) => page.locator(`.pick[data-product-id="${id}"]`);

test('보관한 옷만 고를 수 있다', async ({ page }) => {
  await setup(page);
  await expect(tab(page, '상의')).toContainText('3');
  await expect(tab(page, '하의')).toContainText('2');
  await expect(tab(page, '원피스')).toContainText('1');
  await expect(tab(page, '아우터')).toContainText('2');
  await expect(pick(page, 'p003')).toHaveCount(0); // 보관 안 한 블라우스
  await page.screenshot({ path: `${SHOTS}/40-styling-empty.png` });
});

test('상의만 바꾸면 하의 레이어는 같은 요소 그대로, 모델은 절대 다시 그리지 않는다', async ({ page }) => {
  await setup(page);
  const modelSrc = await page.locator('[data-slot=model]').getAttribute('src');
  await pick(page, 'p001').click();
  await tab(page, '하의').click();
  await pick(page, 'p008').click();
  expect(await layers(page)).toEqual(['model:', 'bottom:p008', 'top:p001']);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/41-styling-top-bottom.png` });

  // 하의 DOM 요소에 표식을 남기고 상의만 교체
  await page.locator('[data-slot=bottom]').evaluate((el) => el.setAttribute('data-marker', 'kept'));
  await tab(page, '상의').click();
  await pick(page, 'p002').click();
  expect(await layers(page)).toEqual(['model:', 'bottom:p008', 'top:p002']);
  await expect(page.locator('[data-slot=bottom][data-marker=kept]')).toHaveCount(1);
  expect(await page.locator('[data-slot=model]').getAttribute('src')).toBe(modelSrc);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/42-styling-swap-top.png` });

  // 하의만 교체해도 상의 유지
  await page.locator('[data-slot=top]').evaluate((el) => el.setAttribute('data-marker', 'kept'));
  await tab(page, '하의').click();
  await pick(page, 'p009').click();
  expect(await layers(page)).toEqual(['model:', 'bottom:p009', 'top:p002']);
  await expect(page.locator('[data-slot=top][data-marker=kept]')).toHaveCount(1);
});

test('원피스·아우터 규칙, 새로고침 유지, 입은 옷에서 구매 정보', async ({ page }) => {
  await setup(page);
  await pick(page, 'p007').click();
  await tab(page, '하의').click();
  await pick(page, 'p009').click();
  await tab(page, '원피스').click();
  await pick(page, 'p004').click();
  expect(await layers(page)).toEqual(['model:', 'dress:p004']);
  await tab(page, '아우터').click();
  await pick(page, 'p006').click();
  expect(await layers(page)).toEqual(['model:', 'dress:p004', 'outer:p006']);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/43-styling-dress-coat.png` });

  // 상의를 고르면 원피스가 벗겨지고 기억한 하의(p009)가 돌아온다
  await tab(page, '상의').click();
  await pick(page, 'p001').click();
  expect(await layers(page)).toEqual(['model:', 'bottom:p009', 'top:p001', 'outer:p006']);
  await tab(page, '아우터').click();
  await pick(page, 'p005').click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/44-styling-jacket.png` });

  await page.reload();
  await expect(page.getByTestId('fit-canvas')).toBeVisible();
  expect(await layers(page)).toEqual(['model:', 'bottom:p009', 'top:p001', 'outer:p005']);

  // 입은 옷 → 구매 정보 → 보관함에서 삭제하면 코디에서도 빠진다
  await page.getByRole('button', { name: /체크 A라인 미니스커트 구매 정보/ }).click();
  await expect(page.getByTestId('sheet')).toHaveAttribute('data-product-id', 'p009');
  await page.getByTestId('sheet').getByRole('button', { name: '삭제' }).click();
  await expect(page.getByTestId('sheet')).toHaveCount(0);
  expect(await layers(page)).toEqual(['model:', 'top:p001', 'outer:p005']);
  await expect(page).toHaveURL(/#\/styling$/);

  // 뒤로가기 한 번 → 보관함
  await page.getByRole('button', { name: '보관함으로 돌아가기' }).click();
  await expect(page).toHaveURL(/#\/saved$/);
});

test('보관한 옷이 없으면 탐색으로 안내한다', async ({ page }) => {
  await open(page);
  await dismissGuide(page, true);
  await page.goto('/?catalog=dummy#/styling');
  await expect(page.getByText('보관한 옷이 없어요')).toBeVisible();
});
