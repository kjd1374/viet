import { describe, expect, it } from 'vitest';
import { PRODUCT_BY_ID, PRODUCTS } from '../data/products';
import { AppStore } from './appStore';
import { createIdbLocalStore } from './idbLocal';
import { MockServer, NO_FAULTS } from './mockServer';
import { EMPTY_OUTFIT, visibleLayers, wear } from './outfit';
import { LOCAL_SCOPE } from './types';

const P = (id: string) => PRODUCT_BY_ID.get(id)!;
const all = () => true;
const ids = (o: typeof EMPTY_OUTFIT, saved: (id: string) => boolean = all) => visibleLayers(o, saved).map((l) => `${l.slot}:${l.id}`);

describe('더미 상품 분류', () => {
  it('20개 모두 분류와 착용 레이어가 있고 상의·하의·원피스·아우터가 모두 있다', () => {
    expect(PRODUCTS.every((p) => p.category && p.layerUrl.startsWith('data:image/svg+xml'))).toBe(true);
    const count = (c: string) => PRODUCTS.filter((p) => p.category === c).length;
    expect([count('top'), count('bottom'), count('dress'), count('outer')]).toEqual([8, 6, 2, 4]);
  });
});

describe('코디 규칙', () => {
  it('상의만 바꾸면 하의는 그대로', () => {
    let o = wear(EMPTY_OUTFIT, P('p001'));
    o = wear(o, P('p008'));
    expect(ids(o)).toEqual(['bottom:p008', 'top:p001']);
    o = wear(o, P('p002'));
    expect(ids(o)).toEqual(['bottom:p008', 'top:p002']);
  });

  it('원피스는 상의·하의를 덮고, 상의를 다시 고르면 기억한 하의가 돌아온다', () => {
    let o = wear(wear(EMPTY_OUTFIT, P('p001')), P('p008'));
    o = wear(o, P('p004'));
    expect(ids(o)).toEqual(['dress:p004']);
    o = wear(o, P('p011'));
    expect(ids(o)).toEqual(['bottom:p008', 'top:p011']);
  });

  it('아우터는 항상 맨 위, 원피스 위에도 입는다', () => {
    let o = wear(wear(EMPTY_OUTFIT, P('p004')), P('p005'));
    expect(ids(o)).toEqual(['dress:p004', 'outer:p005']);
    o = wear(wear(wear(EMPTY_OUTFIT, P('p006')), P('p001')), P('p008'));
    expect(ids(o)).toEqual(['bottom:p008', 'top:p001', 'outer:p006']);
  });

  it('입은 옷을 다시 고르면 벗는다', () => {
    const o = wear(wear(EMPTY_OUTFIT, P('p001')), P('p001'));
    expect(ids(o)).toEqual([]);
  });

  it('보관함에서 빠진 옷은 보이지 않는다', () => {
    const o = wear(wear(EMPTY_OUTFIT, P('p001')), P('p008'));
    expect(ids(o, (id) => id !== 'p008')).toEqual(['top:p001']);
  });

  it('원피스가 보관함에서 빠지면 기억한 상의·하의가 보인다', () => {
    const o = wear(wear(wear(EMPTY_OUTFIT, P('p001')), P('p008')), P('p004'));
    expect(ids(o, (id) => id !== 'p004')).toEqual(['bottom:p008', 'top:p001']);
  });

  it('착장은 새로고침 후에도 유지되고 안내 숨기기와 서로 덮어쓰지 않는다', async () => {
    const make = async () => {
      const s = new AppStore(createIdbLocalStore('outfit-db'), new MockServer(() => NO_FAULTS, 'outfit-srv'), LOCAL_SCOPE);
      await s.init();
      return s;
    };
    const s = await make();
    s.setOutfit(wear(EMPTY_OUTFIT, P('p001')));
    s.setGuideHidden(true);
    await new Promise((r) => setTimeout(r, 30));
    const r = await make();
    expect(r.getState().outfit.top).toBe('p001');
    expect(r.getState().guideHidden).toBe(true);
  });
});
