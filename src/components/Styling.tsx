import { useEffect, useMemo, useState } from 'react';
import type { Category } from '../data/figure';
import { formatPrice, PRODUCT_BY_ID, type Product } from '../data/products';
import { store } from '../store/instance';
import { takeOff, visibleLayers, wear, type Outfit } from '../store/outfit';
import { IconBack } from './Icons';

const TABS: { key: Category; label: string; empty: string }[] = [
  { key: 'top', label: '상의', empty: '보관함에 상의가 없어요.' },
  { key: 'bottom', label: '하의', empty: '보관함에 하의가 없어요.' },
  { key: 'dress', label: '원피스', empty: '보관함에 원피스가 없어요.' },
  { key: 'outer', label: '아우터', empty: '보관함에 아우터가 없어요.' },
];

type Props = {
  saved: Product[];
  outfit: Outfit;
  onBack: () => void;
  onDeck: () => void;
  onInfo: (productId: string) => void;
};

const SLOT_LABEL: Record<Category, string> = { top: '상의', bottom: '하의', dress: '원피스', outer: '아우터' };

const boardImage = (p: Product) => p.boardImageUrl ?? p.imageUrl;

/**
 * 코디 보드: 보관함의 옷 상품컷을 자리(아우터 | 상의 / 하의, 또는 원피스)에 나란히 놓는다.
 * 몸에 입히지 않으므로 어떤 상품 사진이든(토르소컷·바닥컷) 그대로 깔끔하게 보인다.
 * 자리마다 독립된 요소라서 상의만 바꾸면 하의 카드는 그대로 있다.
 */
export function Styling({ saved, outfit, onBack, onDeck, onInfo }: Props) {
  const savedIds = useMemo(() => new Set(saved.map((p) => p.id)), [saved]);
  const byCat = useMemo(() => {
    const m: Record<Category, Product[]> = { top: [], bottom: [], dress: [], outer: [] };
    for (const p of saved) m[p.category].push(p);
    return m;
  }, [saved]);
  const [tab, setTab] = useState<Category>(() => TABS.find((t) => byCat[t.key].length)?.key ?? 'top');

  // 보관함 옷의 상품컷을 미리 받아 디코드 → 누르는 순간 바로 바뀐다
  useEffect(() => {
    for (const p of saved) {
      const img = new Image();
      img.src = boardImage(p);
      img.decode?.().catch(() => {});
    }
  }, [saved]);

  const layers = visibleLayers(outfit, (id) => savedIds.has(id));
  const worn = layers.map((l) => PRODUCT_BY_ID.get(l.id)!);
  const total = worn.reduce((s, p) => s + p.priceAmount, 0);
  const shown = new Map(layers.map((l) => [l.slot, PRODUCT_BY_ID.get(l.id)!]));
  // 원피스를 입으면 상의·하의 자리를 원피스 한 칸이 차지한다. 아우터가 없으면 아우터 칸을 빼고 한 줄로
  const hasOuter = shown.has('outer');
  const slots: Category[] = [...(hasOuter ? (['outer'] as const) : []), ...(shown.has('dress') ? (['dress'] as const) : (['top', 'bottom'] as const))];

  const put = (p: Product) => store.setOutfit(wear(outfit, p));
  const current = TABS.find((t) => t.key === tab)!;
  const items = byCat[tab];
  const slotId = outfit[tab] && savedIds.has(outfit[tab]!) ? outfit[tab] : null;

  return (
    <section className="styling" aria-label="코디">
      <header className="list-head">
        <button className="icon-btn" onClick={onBack} aria-label="보관함으로 돌아가기">
          <IconBack />
        </button>
        <h1>코디</h1>
        <button className="btn-text" onClick={() => store.setOutfit({ top: null, bottom: null, dress: null, outer: null })} disabled={!layers.length}>
          모두 벗기
        </button>
      </header>

      {saved.length === 0 ? (
        <div className="empty">
          <p className="empty-title">보관한 옷이 없어요</p>
          <p className="empty-hint">탐색에서 오른쪽으로 밀어 보관한 옷으로만 코디할 수 있어요.</p>
          <button className="btn" onClick={onDeck}>탐색하러 가기</button>
        </div>
      ) : (
        <>
          <div className="board-stage">
            <div className={hasOuter ? 'board' : 'board single'} data-testid="outfit-board">
              {slots.map((slot) => {
                const p = shown.get(slot);
                return p ? (
                  <button
                    key={slot}
                    className={`board-card ${slot}`}
                    onClick={() => onInfo(p.id)}
                    aria-label={`${p.title} 구매 정보`}
                    data-slot={slot}
                    data-product-id={p.id}
                  >
                    <img key={p.id} className="enter" src={boardImage(p)} alt="" draggable={false} />
                    <span className="board-cap">
                      <span className="board-title">{p.title}</span>
                      <b>{formatPrice(p)}</b>
                    </span>
                  </button>
                ) : (
                  <button key={slot} className={`board-card ${slot} empty`} onClick={() => setTab(slot)} data-slot={slot}>
                    {SLOT_LABEL[slot]} 고르기
                  </button>
                );
              })}
            </div>
            <div className="board-foot">
              {worn.some((p) => p.isDummy) && <span className="badge-dummy">샘플 상품</span>}
              {!hasOuter && byCat.outer.length > 0 && (
                <button className="btn-text board-add" onClick={() => setTab('outer')}>
                  + 아우터
                </button>
              )}
              {worn.length > 0 && <b className="board-total">합계 {formatPrice({ ...worn[0], priceAmount: total })}</b>}
            </div>
          </div>

          <div className="picker">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? 'tab on' : 'tab'}
                  onClick={() => setTab(t.key)}
                >
                  {t.label} <span>{byCat[t.key].length}</span>
                </button>
              ))}
            </div>
            <div className="strip" role="tabpanel" aria-label={current.label}>
              {items.length === 0 ? (
                <p className="strip-empty">
                  {current.empty} <button className="btn-text" onClick={onDeck}>탐색하기</button>
                </p>
              ) : (
                <>
                  {slotId && (
                    <button className="pick off" onClick={() => store.setOutfit(takeOff(outfit, tab))}>
                      벗기
                    </button>
                  )}
                  {items.map((p) => (
                    <button
                      key={p.id}
                      className={outfit[tab] === p.id ? 'pick on' : 'pick'}
                      aria-pressed={outfit[tab] === p.id}
                      onClick={() => put(p)}
                      data-product-id={p.id}
                    >
                      <img src={boardImage(p)} alt="" width={60} height={80} />
                      <span className="pick-title">{p.title}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
