import { expect, type Page } from '@playwright/test';

export const SHOTS = 'docs/screenshots';

export async function open(page: Page, query = '') {
  await page.goto(`/${query}#/`);
  await expect(page.getByTestId('guide').or(page.getByTestId('top-card')).first()).toBeVisible();
}

export async function dismissGuide(page: Page, hide = false) {
  const guide = page.getByTestId('guide');
  if (await guide.isVisible()) {
    if (hide) await guide.getByLabel('다음부터 안내 숨기기').check();
    await guide.getByRole('button', { name: '시작하기' }).click();
    await expect(guide).toBeHidden();
  }
}

export const topId = (page: Page) => page.getByTestId('top-card').getAttribute('data-product-id');

export const stateOf = (page: Page, id: string) =>
  page.evaluate((pid) => (window as any).__store.stateOf(pid) as string, id);

export const decisions = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.values((window as any).__store.getState().decisions as Record<string, { productId: string; state: string }>).map(
        (d) => [d.productId, d.state],
      ),
    ),
  );

export const syncState = (page: Page) => page.evaluate(() => (window as any).__store.getState().sync);
export const serverStats = (page: Page) => page.evaluate(() => ({ ...(window as any).__server.stats }));
export const setFaults = (page: Page, f: Record<string, unknown>) =>
  page.evaluate((x) => (window as any).__setFaults(x), f);

async function cardCenter(page: Page) {
  const box = (await page.getByTestId('top-card').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height * 0.4, box };
}

/**
 * CDP로 실제 터치 이벤트를 보낸다 (브라우저가 pointerType=touch 포인터 이벤트로 변환).
 * Chromium 계열에서만 동작한다.
 */
export async function touchSwipe(page: Page, dx: number, dy: number, opts: { steps?: number; stepMs?: number } = {}) {
  const { steps = 12, stepMs = 16 } = opts;
  const { x, y } = await cardCenter(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }],
    });
    if (stepMs) await page.waitForTimeout(stepMs);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** 손을 떼지 않은 채 멈춘 상태 (스크린샷용). 반환 함수로 마무리한다. */
export async function touchHold(page: Page, dx: number, dy: number) {
  const { x, y } = await cardCenter(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }] });
    await page.waitForTimeout(16);
  }
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
}

export async function mouseSwipe(page: Page, dx: number, dy: number) {
  const { x, y } = await cardCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  await page.mouse.up();
}

export const button = (page: Page, name: '삭제' | '보류' | '보관') =>
  page.getByRole('navigation', { name: '결정' }).getByRole('button', { name });

/** 버튼 연타 가드(300ms)를 넘겨 의도적인 연속 입력으로 누른다 */
export async function press(page: Page, name: '삭제' | '보류' | '보관') {
  await button(page, name).click();
  await page.waitForTimeout(320);
}
