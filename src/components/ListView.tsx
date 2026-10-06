import { formatPrice, TRADE_LABEL, type Product } from '../data/products';
import { IconBack } from './Icons';

type Props = {
  kind: 'saved' | 'held';
  items: Product[];
  onBack: () => void;
  onOpen: (productId: string) => void;
  onGoOther: () => void;
  otherCount: number;
  onStyling?: () => void;
};

const COPY = {
  saved: {
    title: '보관함',
    empty: '보관한 상품이 없어요',
    emptyHint: '탐색에서 오른쪽으로 밀면 여기에 저장돼요.',
    other: '보류 목록',
  },
  held: {
    title: '보류 목록',
    empty: '보류한 상품이 없어요',
    emptyHint: '탐색 화면 아래의 보류 버튼으로 나중에 결정할 상품을 모아 두세요.',
    other: '보관함',
  },
};

export function ListView({ kind, items, onBack, onOpen, onGoOther, otherCount, onStyling }: Props) {
  const c = COPY[kind];
  return (
    <section className="list" aria-label={c.title}>
      <header className="list-head">
        <button className="icon-btn" onClick={onBack} aria-label="탐색으로 돌아가기">
          <IconBack />
        </button>
        <h1>
          {c.title} <span className="count">{items.length}</span>
        </h1>
        <button className="btn-text" onClick={onGoOther}>
          {c.other} {otherCount}
        </button>
      </header>

      <div className="list-scroll">
        {onStyling && items.length > 0 && (
          <button className="cta-styling" onClick={onStyling}>
            <span>
              <b>보관한 옷으로 코디하기</b>
              <small>고정 모델에 상의·하의·아우터를 따로 입혀 보세요</small>
            </span>
            <span aria-hidden>→</span>
          </button>
        )}
        {items.length === 0 ? (
          <div className="empty">
            <p className="empty-title">{c.empty}</p>
            <p className="empty-hint">{c.emptyHint}</p>
            <button className="btn" onClick={onBack}>탐색으로</button>
          </div>
        ) : (
          <ul className="grid">
            {items.map((p) => (
              <li key={p.id}>
                <button className="tile" onClick={() => onOpen(p.id)} data-product-id={p.id}>
                  <span className="tile-img">
                    <img src={p.imageUrl} alt="" width={300} height={400} loading="lazy" />
                    <span className="badge-dummy small">더미</span>
                  </span>
                  <span className="tile-title">{p.title}</span>
                  <span className="tile-meta">
                    <b>{formatPrice(p)}</b>
                    <span className={`chip chip-${p.tradeType} small`}>{TRADE_LABEL[p.tradeType]}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="local-note">선택 기록은 이 브라우저에만 저장됩니다. 다른 기기와 동기화되지 않아요.</p>
      </div>
    </section>
  );
}
