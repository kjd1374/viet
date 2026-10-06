import { expect, test } from '@playwright/test';
import {
  button,
  decisions,
  dismissGuide,
  open,
  press,
  serverStats,
  setFaults,
  SHOTS,
  stateOf,
  syncState,
  topId,
  touchHold,
  touchSwipe,
} from './helpers';

test.describe('1단계 · 첫 화면', () => {
  test('신규 빈 상태: 고유 더미 20개, 한국어 UI, 더미 표시', async ({ page }) => {
    await open(page);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/01-guide.png` });
    await dismissGuide(page);
    expect(await topId(page)).toBe('p001');
    const ids = await page.evaluate(() => {
      const s = (window as any).__store;
      return Object.keys(s.getState().decisions).length;
    });
    expect(ids).toBe(0);
    await expect(page.getByTestId('top-card').getByText('더미 상품')).toBeVisible();
    await expect(page.getByTestId('top-card').getByText('$4.20')).toBeVisible();
    await expect(page.getByTestId('top-card').getByText('도매', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /보관함 0개/ })).toBeVisible();
    expect(await page.locator('html').getAttribute('lang')).toBe('ko');
    await page.screenshot({ path: `${SHOTS}/02-deck.png` });
  });

  test('사이즈 정보가 없는 상품은 사이즈를 표시하지 않는다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    for (let i = 0; i < 3; i++) await press(page, '삭제');
    expect(await topId(page)).toBe('p004'); // 사이즈 없음
    await expect(page.getByTestId('top-card').getByLabel('사이즈')).toHaveCount(0);
  });
});

test.describe('2단계 · 좌우 스와이프와 보관함', () => {
  test('터치 왼쪽 스와이프 = 삭제, 새로고침 후에도 유지', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    const release = await touchHold(page, -110, 6);
    await page.screenshot({ path: `${SHOTS}/03-drag-left.png` });
    await release();
    await expect.poll(() => topId(page)).toBe('p002');
    expect(await stateOf(page, 'p001')).toBe('deleted');
    await page.reload();
    await expect(page.getByTestId('top-card')).toBeVisible();
    expect(await topId(page)).toBe('p002');
    expect(await stateOf(page, 'p001')).toBe('deleted');
  });

  test('터치 오른쪽 스와이프 = 보관, 보관함에 정확히 한 번', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    const release = await touchHold(page, 120, -4);
    await page.screenshot({ path: `${SHOTS}/04-drag-right.png` });
    await release();
    await expect.poll(() => topId(page)).toBe('p002');
    await page.getByRole('button', { name: /보관함 1개/ }).click();
    await expect(page.locator('.tile')).toHaveCount(1);
    await expect(page.locator('.tile[data-product-id="p001"]')).toBeVisible();
  });

  test('빠른 플릭(짧은 거리, 빠른 속도)도 확정된다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await touchSwipe(page, 70, 0, { steps: 4, stepMs: 8 }); // 70px / ~40ms
    await expect.poll(() => topId(page)).toBe('p002');
    expect(await stateOf(page, 'p001')).toBe('saved');
  });

  test('확정되지 않은 짧은 드래그는 원위치, 상태 변화 없음', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await touchSwipe(page, 40, 0, { steps: 10, stepMs: 30 }); // 느리고 짧게
    await page.waitForTimeout(400);
    expect(await topId(page)).toBe('p001');
    expect(await decisions(page)).toEqual({});
    const transform = await page.getByTestId('top-card').evaluate((el) => getComputedStyle(el).transform);
    expect(transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
  });

  test('아래로 끄는 세로 드래그는 아무 동작도 하지 않는다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await touchSwipe(page, 30, 220);
    await page.waitForTimeout(400);
    expect(await topId(page)).toBe('p001');
    expect(await decisions(page)).toEqual({});
    await expect(page.getByTestId('sheet')).toHaveCount(0);
  });

  test('보관 버튼 실수 연타(더블탭)는 한 상품만 처리한다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await button(page, '보관').dblclick();
    await page.waitForTimeout(350);
    expect(await decisions(page)).toEqual({ p001: 'saved' });
    expect(await topId(page)).toBe('p002');
  });

  test('의도적인 연속 입력(간격 있음)은 각각 처리된다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await press(page, '보관');
    await press(page, '보관');
    await press(page, '삭제');
    expect(await decisions(page)).toEqual({ p001: 'saved', p002: 'saved', p003: 'deleted' });
  });

  test('되돌리기 토스트로 직전 결정을 취소한다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await press(page, '삭제');
    await expect(page.getByRole('button', { name: '되돌리기' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/05-undo-toast.png` });
    await page.getByRole('button', { name: '되돌리기' }).click();
    await expect.poll(() => topId(page)).toBe('p001');
    expect(await stateOf(page, 'p001')).toBe('unseen');
  });
});

test.describe('3단계 · 보류', () => {
  test('보류 → 목록에서 다시 열고 보관으로 변경 → 양쪽 목록에 정확히 반영', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await press(page, '보류');
    await press(page, '보류');
    expect(await topId(page)).toBe('p003'); // 보류 상품은 덱에 다시 섞이지 않음
    await page.getByRole('button', { name: /보류 목록 2개/ }).click();
    await expect(page.locator('.tile')).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/06-held-list.png` });

    await page.locator('.tile[data-product-id="p001"]').click();
    await expect(page.getByTestId('sheet')).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/07-held-sheet.png` });
    await page.getByTestId('sheet').getByRole('button', { name: '보관함에 저장' }).click();
    await expect(page.getByTestId('sheet')).toHaveCount(0);
    await expect(page.locator('.tile')).toHaveCount(1);
    await expect(page.locator('.tile[data-product-id="p001"]')).toHaveCount(0);

    await page.locator('.tile[data-product-id="p002"]').click();
    await page.getByTestId('sheet').getByRole('button', { name: '삭제' }).click();
    await expect(page.getByText('보류한 상품이 없어요')).toBeVisible();

    // 목록 → 탐색: 뒤로가기 한 번
    await page.goBack();
    await expect(page.getByTestId('top-card')).toBeVisible();
    expect(await topId(page)).toBe('p003');
    expect(await decisions(page)).toEqual({ p001: 'saved', p002: 'deleted' });
    await page.getByRole('button', { name: /보관함 1개/ }).click();
    await expect(page.locator('.tile[data-product-id="p001"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/08-saved-list.png` });
  });
});

test.describe('4단계 · 구매 정보', () => {
  test('위로 스와이프 → 상세, 상태 불변, 뒤로가기 한 번에 같은 카드', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await press(page, '삭제'); // p002에서 시작해 "첫 상품으로 돌아가는" 버그를 구분
    const before = await page.evaluate(() => history.length);
    const release = await touchHold(page, 0, -140);
    await page.screenshot({ path: `${SHOTS}/09-drag-up.png` });
    await release();
    await expect(page.getByTestId('sheet')).toBeVisible();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-product-id', 'p002');
    await expect(page.getByTestId('sheet').getByText('없음 (샘플 데이터)')).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${SHOTS}/10-sheet.png` });
    expect(await stateOf(page, 'p002')).toBe('unseen');

    await page.goBack();
    await expect(page.getByTestId('sheet')).toHaveCount(0);
    expect(await topId(page)).toBe('p002');
    expect(new URL(page.url()).hash).toBe('#/');
    expect(await page.evaluate(() => history.state?.sheet ?? null)).toBeNull();
    expect(await page.evaluate(() => history.length)).toBe(before + 1); // 시트용 1개만 쌓였었다
  });

  test('구매 정보 버튼 → 닫기 버튼 한 번에 같은 카드, 다음 카드로 넘어가지 않음', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await press(page, '보관');
    await page.getByTestId('top-card').getByRole('button', { name: '구매 정보 보기' }).click();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-product-id', 'p002');
    await page.getByTestId('sheet').getByRole('button', { name: '닫기' }).click();
    await expect(page.getByTestId('sheet')).toHaveCount(0);
    expect(await topId(page)).toBe('p002');
    expect(await decisions(page)).toEqual({ p001: 'saved' });
    // 닫기가 history.back()을 썼으므로 다시 뒤로가면 시트가 아니라 앱 이전 페이지로 간다
    expect(await page.evaluate(() => history.state?.sheet ?? null)).toBeNull();
  });

  test('시트를 아래로 끌어 닫는다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    await page.getByTestId('top-card').getByRole('button', { name: '구매 정보 보기' }).click();
    await page.waitForTimeout(350); // 시트 등장 애니메이션
    const grip = (await page.locator('.sheet-grip').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const x = grip.x + grip.width / 2;
    const y = grip.y + 10;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + i * 20 }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByTestId('sheet')).toHaveCount(0);
    expect(await topId(page)).toBe('p001');
  });

  test('외부 페이지로 나갔다 돌아와도 같은 카드·상태', async ({ page }) => {
    await open(page);
    await dismissGuide(page, true);
    await press(page, '보관');
    await press(page, '보류');
    await page.getByTestId('top-card').getByRole('button', { name: '구매 정보 보기' }).click();
    await page.goto('about:blank'); // 원 판매처를 같은 탭에서 연 경우
    await page.goBack();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-product-id', 'p003');
    await page.goBack();
    await expect(page.getByTestId('sheet')).toHaveCount(0);
    expect(await topId(page)).toBe('p003');
    expect(await decisions(page)).toEqual({ p001: 'saved', p002: 'held' });
  });
});

test.describe('5단계 · 속도와 동기화 (모의 서버)', () => {
  test('서버 2초 지연에도 카드 전환은 응답을 기다리지 않는다 + 프레임 측정', async ({ page }) => {
    await open(page, '?dev');
    await dismissGuide(page);
    await setFaults(page, { delayMs: 2000 });
    await page.evaluate(() => (window as any).__perf.reset());

    const switchTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const before = await topId(page);
      const t0 = Date.now();
      await touchSwipe(page, i % 2 ? -150 : 150, 0, { steps: 6, stepMs: 8 });
      await expect.poll(() => topId(page), { intervals: [5] }).not.toBe(before);
      switchTimes.push(Date.now() - t0);
    }
    const sync = await syncState(page);
    expect(sync.pending).toBeGreaterThan(0); // 서버는 아직 응답 전
    await expect(page.locator('.sync')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/11-sync-pending-2s.png` });

    await page.waitForTimeout(400);
    const perf = await page.evaluate(() => (window as any).__perf.stats());
    console.log('[perf] commit→paint(이중 rAF) ms', JSON.stringify(perf));
    console.log('[perf] 터치 시작→다음 카드 감지(자동화 왕복 포함) ms', switchTimes.join(','));
    expect(perf.n).toBe(10);
    expect(perf.p95).toBeLessThan(100);
    // 2초 지연이 카드를 막았다면 10장에 20초 이상 걸렸을 것
    expect(Math.max(...switchTimes)).toBeLessThan(1500);

    await expect.poll(() => syncState(page).then((s) => s.pending), { timeout: 30_000 }).toBe(0);
    const stats = await serverStats(page);
    expect(stats.applied).toBe(10);
    expect(stats.duplicates).toBe(0);
  });

  test('서버 실패 → 실패 표시 → 재시도 → 한 번만 적용', async ({ page }) => {
    await open(page, '?dev');
    await dismissGuide(page);
    await setFaults(page, { failBefore: true });
    await press(page, '보관');
    expect(await topId(page)).toBe('p002'); // 실패해도 탐색은 막히지 않음
    await expect(page.getByRole('button', { name: /모의 서버 전송 실패/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/12-sync-failed.png` });
    await setFaults(page, { failBefore: false });
    await page.getByRole('button', { name: /모의 서버 전송 실패/ }).click();
    await expect.poll(() => syncState(page).then((s) => s.pending)).toBe(0);
    await expect(page.locator('.sync')).toHaveCount(0);
    const stats = await serverStats(page);
    expect(stats.applied).toBe(1);
    expect(stats.duplicates).toBe(0);
  });

  test('응답 유실(서버는 처리) 후 재시도해도 중복 적용되지 않는다', async ({ page }) => {
    await open(page, '?dev');
    await dismissGuide(page);
    await setFaults(page, { dropResponse: true });
    await press(page, '삭제');
    await expect(page.getByRole('button', { name: /모의 서버 전송 실패/ })).toBeVisible();
    await setFaults(page, { dropResponse: false });
    await expect.poll(() => syncState(page).then((s) => s.pending), { timeout: 20_000 }).toBe(0);
    const stats = await serverStats(page);
    expect(stats.applied).toBe(1);
    expect(stats.duplicates).toBeGreaterThanOrEqual(1);
  });

  test('오프라인 중 동작 → 새로고침 → 미완료 작업 복원 → 온라인 시 재개', async ({ page }) => {
    await open(page, '?dev');
    await dismissGuide(page);
    await setFaults(page, { offline: true });
    await press(page, '보관');
    await press(page, '삭제');
    await button(page, '보류').click(); // 새로고침 직전 동작
    await page.waitForTimeout(60);
    await page.reload();
    await expect(page.getByTestId('top-card')).toBeVisible();
    expect(await decisions(page)).toEqual({ p001: 'saved', p002: 'deleted', p003: 'held' });
    expect(await topId(page)).toBe('p004');
    await expect(page.getByText(/오프라인 · 3건 대기/)).toBeVisible();
    await dismissGuide(page);
    await page.screenshot({ path: `${SHOTS}/13-offline-restored.png` });
    // 상태 배지가 떠도 레이아웃이 가로로 넘치지 않는다 (회귀 방지)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: '사용 안내 보기' })).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('top-card')).toBeInViewport({ ratio: 1 });
    await setFaults(page, { offline: false });
    await expect.poll(() => syncState(page).then((s) => s.pending), { timeout: 20_000 }).toBe(0);
    expect((await serverStats(page)).duplicates).toBe(0);
  });

  test('기기 저장 실패 → 저장된 척하지 않고 되돌림 → 다시 시도', async ({ page }) => {
    await open(page, '?dev');
    await dismissGuide(page);
    await setFaults(page, { localFail: true });
    await press(page, '보관');
    await expect(page.getByRole('alert')).toContainText('기기에 저장하지 못해');
    expect(await topId(page)).toBe('p001'); // 되돌려짐
    await page.screenshot({ path: `${SHOTS}/14-local-fail.png` });
    await setFaults(page, { localFail: false });
    await page.getByRole('button', { name: '다시 시도' }).click();
    await expect.poll(() => stateOf(page, 'p001')).toBe('saved');
    await page.reload();
    await expect(page.getByTestId('top-card')).toBeVisible();
    expect(await stateOf(page, 'p001')).toBe('saved');
  });
});

test.describe('6단계 · 안내와 덱 소진', () => {
  test('안내 숨기기는 재접속 후 유지되고 ? 버튼으로 다시 열 수 있다', async ({ page }) => {
    await open(page);
    await dismissGuide(page, true);
    await page.reload();
    await expect(page.getByTestId('top-card')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('guide')).toHaveCount(0);
    await page.getByRole('button', { name: '사용 안내 보기' }).click();
    await expect(page.getByTestId('guide')).toBeVisible();
    await expect(page.getByLabel('다음부터 안내 숨기기')).toBeChecked();
    // 숨기기 해제 → 다음 접속 때 다시 보임
    await page.getByLabel('다음부터 안내 숨기기').uncheck();
    await page.getByRole('button', { name: '시작하기' }).click();
    await page.reload();
    await expect(page.getByTestId('guide')).toBeVisible();
  });

  test('20개를 모두 처리하면 소진 화면, 새로고침해도 되살아나지 않는다', async ({ page }) => {
    await open(page);
    await dismissGuide(page);
    const order = ['삭제', '보관', '보류', '삭제'] as const;
    for (let i = 0; i < 20; i++) await press(page, order[i % 4]);
    await expect(page.getByText('모든 상품을 확인했어요')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/15-deck-empty.png` });
    await page.reload();
    await expect(page.getByText('모든 상품을 확인했어요')).toBeVisible();
    await expect(page.getByTestId('top-card')).toHaveCount(0);
    const d = await decisions(page);
    expect(Object.values(d).filter((s) => s === 'deleted')).toHaveLength(10);
    expect(Object.values(d).filter((s) => s === 'saved')).toHaveLength(5);
    expect(Object.values(d).filter((s) => s === 'held')).toHaveLength(5);
  });
});

test.describe('화면 크기 대응', () => {
  for (const vp of [
    { name: 'small-320x568', width: 320, height: 568 },
    { name: 'landscape-844x390', width: 844, height: 390 },
    { name: 'tablet-768x1024', width: 768, height: 1024 },
  ]) {
    test(`${vp.name}: 넘침 없이 카드·버튼·상단 바가 모두 화면 안`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await open(page, '?dev');
      await dismissGuide(page);
      await setFaults(page, { offline: true });
      await press(page, '보관');
      await expect(page.locator('.sync')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const loc of [
        page.getByTestId('top-card'),
        page.getByRole('button', { name: '사용 안내 보기' }),
        page.getByRole('button', { name: /보관함/ }),
        button(page, '삭제'),
        button(page, '보관'),
      ])
        await expect(loc).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${SHOTS}/30-${vp.name}.png` });
    });
  }
});
