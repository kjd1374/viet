import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../data/products';
import { AppStore, countOf, deckOf, listOf } from './appStore';
import { createIdbLocalStore, withLocalFaults } from './idbLocal';
import { MockServer, NO_FAULTS, type Faults } from './mockServer';
import { LOCAL_SCOPE } from './types';

let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 같은 DB 이름으로 다시 만들면 "새로고침"과 같다. */
function harness(faults: Partial<Faults> = {}, syncOpts = { baseBackoffMs: 20, maxBackoffMs: 40, timeoutMs: 500 }) {
  const id = ++n;
  const f: Faults = { ...NO_FAULTS, ...faults };
  const localName = `local-${id}`;
  const server = new MockServer(() => f, `server-${id}`);
  const make = async () => {
    const s = new AppStore(withLocalFaults(createIdbLocalStore(localName), () => f.localFail), server, LOCAL_SCOPE, syncOpts);
    await s.init();
    return s;
  };
  return { f, server, make };
}

async function settle(s: AppStore) {
  await s.flush();
  for (let i = 0; i < 200 && s.getState().sync.pending > 0; i++) await sleep(10);
}

describe('더미 데이터와 빈 상태', () => {
  it('신규 빈 상태에서 고유 ID 20개가 덱에 있다', async () => {
    const s = await harness().make();
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(20);
    expect(deckOf(s.getState().decisions)).toHaveLength(20);
    expect(PRODUCTS.every((p) => p.isDummy && p.currency === 'USD' && !p.sourceUrl)).toBe(true);
  });
});

describe('결정 계약', () => {
  it('삭제는 새로고침 후에도 유지되고 덱으로 돌아오지 않는다', async () => {
    const h = harness();
    const s = await h.make();
    s.commit('p001', 'deleted', { expect: ['unseen'] });
    await settle(s);
    const reloaded = await h.make();
    expect(reloaded.stateOf('p001')).toBe('deleted');
    expect(deckOf(reloaded.getState().decisions).map((p) => p.id)).not.toContain('p001');
  });

  it('덱을 모두 소진해도 삭제·보류 상품을 되살리지 않는다', async () => {
    const s = await harness().make();
    PRODUCTS.forEach((p, i) => s.commit(p.id, i % 2 ? 'deleted' : 'held', { expect: ['unseen'] }));
    expect(deckOf(s.getState().decisions)).toHaveLength(0);
    expect(countOf(s.getState().decisions, 'held')).toBe(10);
  });

  it('같은 카드의 빠른 연속 보관은 한 번만 적용되고 다음 카드를 건드리지 않는다', async () => {
    const h = harness();
    const s = await h.make();
    // 화면이 다시 그려지기 전의 연속 입력은 모두 같은 카드 ID를 들고 온다.
    const results = [1, 2, 3, 4].map(() => s.commit('p001', 'saved', { expect: ['unseen'] }));
    expect(results).toEqual([true, false, false, false]);
    expect(listOf(s.getState().decisions, 'saved').map((p) => p.id)).toEqual(['p001']);
    expect(s.stateOf('p002')).toBe('unseen');
    await settle(s);
    expect(h.server.stats.applied).toBe(1);
  });

  it('보류 → 보관 변경 시 보류 목록에서 빠지고 보관함에 한 번 들어간다', async () => {
    const s = await harness().make();
    s.commit('p003', 'held', { expect: ['unseen'] });
    expect(listOf(s.getState().decisions, 'held').map((p) => p.id)).toEqual(['p003']);
    s.commit('p003', 'saved', { expect: ['held'] });
    expect(listOf(s.getState().decisions, 'held')).toHaveLength(0);
    expect(listOf(s.getState().decisions, 'saved').map((p) => p.id)).toEqual(['p003']);
  });

  it('보류된 상품은 덱에 재노출되지 않는다', async () => {
    const s = await harness().make();
    s.commit('p001', 'held', { expect: ['unseen'] });
    expect(deckOf(s.getState().decisions)[0].id).toBe('p002');
  });

  it('되돌리기는 직전 상태로 복원한다', async () => {
    const s = await harness().make();
    s.commit('p001', 'deleted', { expect: ['unseen'], undoable: true });
    expect(s.undo()).toBe(true);
    expect(deckOf(s.getState().decisions)[0].id).toBe('p001');
    expect(s.undo()).toBe(false);
  });

  it('안내 숨기기는 새로고침 후에도 유지된다', async () => {
    const h = harness();
    const s = await h.make();
    s.setGuideHidden(true);
    await sleep(30);
    expect((await h.make()).getState().guideHidden).toBe(true);
  });
});

describe('속도와 동기화 (모의 서버 기준)', () => {
  it('서버 2초 지연에도 다음 카드는 즉시 바뀐다', async () => {
    const h = harness({ delayMs: 2000 }, { baseBackoffMs: 20, maxBackoffMs: 40, timeoutMs: 5000 });
    const s = await h.make();
    const t0 = performance.now();
    s.commit('p001', 'saved', { expect: ['unseen'] });
    const dt = performance.now() - t0;
    expect(deckOf(s.getState().decisions)[0].id).toBe('p002');
    expect(dt).toBeLessThan(20);
    await s.flush();
    expect(s.getState().sync.pending).toBe(1);
    await sleep(2200);
    expect(s.getState().sync.pending).toBe(0);
    expect(h.server.stats.applied).toBe(1);
  }, 10000);

  it('서버 실패 후 재시도는 같은 actionId로 한 번만 적용된다', async () => {
    const h = harness({ failBefore: true });
    const s = await h.make();
    s.commit('p001', 'saved', { expect: ['unseen'] });
    await s.flush();
    await sleep(120);
    expect(s.getState().sync.failing).toBe(true);
    expect(s.getState().sync.pending).toBe(1);
    h.f.failBefore = false;
    await settle(s);
    expect(h.server.stats.applied).toBe(1);
    expect(h.server.stats.duplicates).toBe(0);
    expect(s.getState().sync.failing).toBe(false);
  });

  it('서버가 처리한 뒤 응답이 유실돼도 재시도가 중복 적용되지 않는다', async () => {
    const h = harness({ dropResponse: true });
    const s = await h.make();
    s.commit('p001', 'saved', { expect: ['unseen'] });
    await s.flush();
    await sleep(60);
    h.f.dropResponse = false;
    await settle(s);
    expect(h.server.stats.applied).toBe(1);
    expect(h.server.stats.duplicates).toBeGreaterThanOrEqual(1);
  });

  it('타임아웃 뒤 원래 요청이 늦게 처리돼도 중복 적용되지 않는다', async () => {
    const h = harness({ delayMs: 150 }, { baseBackoffMs: 10, maxBackoffMs: 10, timeoutMs: 50 });
    const s = await h.make();
    s.commit('p001', 'saved', { expect: ['unseen'] });
    await s.flush();
    await sleep(100);
    h.f.delayMs = 0;
    await settle(s);
    await sleep(200); // 늦은 원 요청 도착 대기
    expect(h.server.stats.applied).toBe(1);
    expect((await h.server.readRecord(LOCAL_SCOPE, 'p001'))?.state).toBe('saved');
  });

  it('같은 상품의 연속 변경은 순서대로 적용되고 최종 상태가 유지된다', async () => {
    const h = harness({ delayMs: 30 });
    const s = await h.make();
    s.commit('p001', 'held', { expect: ['unseen'] });
    s.commit('p001', 'saved', { expect: ['held'] });
    s.commit('p001', 'deleted', { expect: ['saved'] });
    await settle(s);
    expect(s.stateOf('p001')).toBe('deleted');
    expect((await h.server.readRecord(LOCAL_SCOPE, 'p001'))?.state).toBe('deleted');
  });

  it('늦은 서버 응답은 더 최신의 로컬 선택을 덮어쓰지 않는다', async () => {
    const h = harness({ delayMs: 80 });
    const s = await h.make();
    s.commit('p001', 'saved', { expect: ['unseen'] });
    await s.flush();
    await sleep(10); // 첫 요청이 서버로 가는 중
    s.commit('p001', 'deleted', { expect: ['saved'] });
    expect(s.stateOf('p001')).toBe('deleted');
    await settle(s);
    expect(s.stateOf('p001')).toBe('deleted');
  });

  it('오프라인 중 동작한 작업은 새로고침 후 복원되어 재개된다', async () => {
    const h = harness({ offline: true });
    const s = await h.make();
    s.commit('p001', 'saved', { expect: ['unseen'] });
    s.commit('p002', 'deleted', { expect: ['unseen'] });
    await s.flush();
    await sleep(50);
    expect(s.getState().sync.pending).toBe(2);
    s.sync.stop(); // 탭 종료

    h.f.offline = false;
    const reloaded = await h.make();
    expect(reloaded.stateOf('p001')).toBe('saved');
    expect(deckOf(reloaded.getState().decisions)[0].id).toBe('p003');
    await settle(reloaded);
    expect(reloaded.getState().sync.pending).toBe(0);
    expect(h.server.stats.applied).toBe(2);
  });

  it('새로고침 직전 동작도 기기 저장이 끝나면 복원된다', async () => {
    const h = harness({ offline: true });
    const s = await h.make();
    s.commit('p005', 'held', { expect: ['unseen'] });
    await s.flush();
    s.sync.stop();
    expect((await h.make()).stateOf('p005')).toBe('held');
  });

  it('기기 저장 실패 시 저장된 척하지 않고 되돌린 뒤 재시도할 수 있다', async () => {
    const h = harness({ localFail: true });
    const s = await h.make();
    s.commit('p001', 'saved', { expect: ['unseen'], undoable: true });
    await s.flush();
    expect(s.stateOf('p001')).toBe('unseen');
    const err = s.getState().error;
    expect(err?.retry).toBeTypeOf('function');
    h.f.localFail = false;
    err!.retry!();
    await settle(s);
    expect(s.stateOf('p001')).toBe('saved');
    expect(h.server.stats.applied).toBe(1);
  });
});
