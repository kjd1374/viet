import { useEffect, useRef } from 'react';
import { formatPrice, TRADE_LABEL, type Product } from '../data/products';
import type { View } from '../route';
import { store } from '../store/instance';
import type { DecisionState } from '../store/types';

const STATE_LABEL: Record<DecisionState, string> = {
  unseen: '아직 결정 안 함',
  saved: '보관함',
  held: '보류 목록',
  deleted: '삭제됨',
};

type Props = {
  product: Product;
  state: DecisionState;
  context: View;
  onClose: () => void;
};

/**
 * 구매 정보·출처 상세. 열기만으로는 어떤 상태도 바꾸지 않는다.
 * 목록(보관함·보류)에서 열었을 때만 상태 변경 버튼을 제공한다.
 */
export function Sheet({ product, state, context, onClose }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    sheetRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const decide = (next: DecisionState) => {
    store.commit(product.id, next, { expect: [state], undoable: true });
    onClose();
  };

  // 손잡이 영역을 아래로 끌어 닫기
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sheetRef.current!.style.transition = 'none';
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    sheetRef.current!.style.transform = `translateY(${d.dy}px)`;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const v = d.dy / Math.max(1, e.timeStamp - d.t0);
    const el = sheetRef.current!;
    if (d.dy > 90 || (v > 0.5 && d.dy > 24)) return onClose();
    el.style.transition = 'transform 240ms cubic-bezier(.22,1,.36,1)';
    el.style.transform = '';
  };

  return (
    <div className="sheet-root" role="presentation">
      <div className="scrim" onClick={onClose} />
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="구매 정보"
        tabIndex={-1}
        data-testid="sheet"
        data-product-id={product.id}
      >
        <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="grip-bar" />
          <div className="sheet-head">
            <h2>구매 정보</h2>
            <button className="btn-text" onClick={onClose}>닫기</button>
          </div>
        </div>

        <div className="sheet-body">
          <div className="sheet-hero">
            <img src={product.imageUrl} alt="" width={96} height={128} />
            <div>
              {product.isDummy && <span className="badge-dummy static">더미 상품</span>}
              <h3>{product.title}</h3>
              <div className="sheet-price">
                {formatPrice(product)} <span className="cur">{product.currency}</span>
              </div>
            </div>
          </div>

          <dl className="facts">
            <dt>출처</dt>
            <dd>{product.sourceName}</dd>
            <dt>거래 구분</dt>
            <dd>{TRADE_LABEL[product.tradeType]}</dd>
            {product.sizes && (
              <>
                <dt>사이즈</dt>
                <dd>{product.sizes.join(' · ')}</dd>
              </>
            )}
            <dt>원 판매처 링크</dt>
            <dd>
              {product.sourceUrl ? (
                <a href={product.sourceUrl} target="_blank" rel="noopener noreferrer">원 판매처 열기</a>
              ) : (
                <span className="muted">없음 (샘플 데이터)</span>
              )}
            </dd>
            <dt>현재 상태</dt>
            <dd>{STATE_LABEL[state]}</dd>
          </dl>

          <p className="notice">
            샘플 데이터입니다. 가격·재고·판매처는 실제가 아니며 이 앱에서는 주문이나 결제를 하지 않습니다.
          </p>
        </div>

        {context !== 'deck' && (
          <div className="sheet-actions">
            {state !== 'saved' && (
              <button className="btn btn-save" onClick={() => decide('saved')}>보관함에 저장</button>
            )}
            {state !== 'held' && (
              <button className="btn btn-hold" onClick={() => decide('held')}>보류로 옮기기</button>
            )}
            {state !== 'deleted' && (
              <button className="btn btn-del" onClick={() => decide('deleted')}>삭제</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
