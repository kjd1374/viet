import type { Category } from '../data/figure';
import type { Product } from '../data/products';

/**
 * 슬롯별로 독립된 코디 상태.
 * - 상의를 바꿔도 하의는 그대로다.
 * - 원피스는 상의·하의 자리를 덮는다. 원피스를 입어도 상의·하의 선택은 기억해 두었다가,
 *   상의나 하의를 다시 고르면 원피스를 벗기고 기억한 나머지 한 벌을 그대로 보여준다.
 */
export type Outfit = { top: string | null; bottom: string | null; dress: string | null; outer: string | null };

export const EMPTY_OUTFIT: Outfit = { top: null, bottom: null, dress: null, outer: null };

/** 아래에서 위로 그리는 순서 */
export const LAYER_ORDER: Category[] = ['bottom', 'top', 'dress', 'outer'];

/** 이미 입은 옷을 다시 고르면 벗는다. */
export function wear(o: Outfit, p: Pick<Product, 'id' | 'category'>): Outfit {
  const slot = p.category;
  if (o[slot] === p.id) return takeOff(o, slot);
  if (slot === 'top' || slot === 'bottom') return { ...o, [slot]: p.id, dress: null };
  return { ...o, [slot]: p.id };
}

export function takeOff(o: Outfit, slot: Category): Outfit {
  return { ...o, [slot]: null };
}

/** 실제로 보이는 레이어 (아래→위). 보관함에서 빠진 상품은 보이지 않는다. */
export function visibleLayers(o: Outfit, isSaved: (id: string) => boolean): { slot: Category; id: string }[] {
  const out: { slot: Category; id: string }[] = [];
  for (const slot of LAYER_ORDER) {
    const id = o[slot];
    if (!id || !isSaved(id)) continue;
    if (o.dress && isSaved(o.dress) && (slot === 'top' || slot === 'bottom')) continue;
    out.push({ slot, id });
  }
  return out;
}

export function isOutfit(v: unknown): v is Outfit {
  return !!v && typeof v === 'object' && ['top', 'bottom', 'dress', 'outer'].every((k) => k in (v as object));
}
