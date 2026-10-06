import { useMemo, useState } from 'react';
import { CANVAS, modelSvg, type Category } from '../data/figure';
import { formatPrice, PRODUCT_BY_ID, type Product } from '../data/products';
import { store } from '../store/instance';
import { takeOff, visibleLayers, wear, type Outfit } from '../store/outfit';
import { IconBack } from './Icons';

const MODEL = modelSvg();

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

/**
 * 코디: 보관함의 옷만 고정 모델에 레이어로 입힌다.
 * 모델 이미지는 한 번도 다시 그리지 않고, 슬롯별 투명 레이어만 교체한다 → 얼굴·체형·자세 고정, 교체 즉시 반영.
 */
export function Styling({ saved, outfit, onBack, onDeck, onInfo }: Props) {
  const savedIds = useMemo(() => new Set(saved.map((p) => p.id)), [saved]);
  const byCat = useMemo(() => {
    const m: Record<Category, Product[]> = { top: [], bottom: [], dress: [], outer: [] };
    for (const p of saved) m[p.category].push(p);
    return m;
  }, [saved]);
  const [tab, setTab] = useState<Category>(() => TABS.find((t) => byCat[t.key].length)?.key ?? 'top');

  const layers = visibleLayers(outfit, (id) => savedIds.has(id));
  const worn = layers.map((l) => PRODUCT_BY_ID.get(l.id)!);
  const total = worn.reduce((s, p) => s + p.priceAmount, 0);

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
          <div className="fit-stage">
            <div className="fit-canvas" style={{ aspectRatio: `${CANVAS.w} / ${CANVAS.h}` }} data-testid="fit-canvas">
              <img className="fit-layer" src={MODEL} alt="고정 모델" draggable={false} data-slot="model" />
              {layers.map((l) => (
                <img
                  key={l.id}
                  className="fit-layer enter"
                  src={PRODUCT_BY_ID.get(l.id)!.layerUrl}
                  alt=""
                  draggable={false}
                  data-slot={l.slot}
                  data-product-id={l.id}
                />
              ))}
            </div>
            <span className="badge-dummy">일러스트 모델 · 더미 상품</span>
            {worn.length > 0 && (
              <ul className="worn" aria-label="입은 옷">
                {worn.map((p) => (
                  <li key={p.id}>
                    <button className="worn-chip" onClick={() => onInfo(p.id)} aria-label={`${p.title} 구매 정보`}>
                      <img src={p.imageUrl} alt="" width={30} height={40} />
                      <span>{formatPrice(p)}</span>
                    </button>
                  </li>
                ))}
                {worn.length > 1 && <li className="worn-total">합계 {formatPrice({ ...worn[0], priceAmount: total })}</li>}
              </ul>
            )}
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
                      <img src={p.imageUrl} alt="" width={60} height={80} />
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
