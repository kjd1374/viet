import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatPrice, TRADE_LABEL, type Product } from '../data/products';
import { perf } from '../perf';
import { store } from '../store/instance';
import { IconBookmark, IconPause, IconUp, IconX } from './Icons';

export type FlyDir = 'left' | 'right' | 'hold';

const NEXT_STATE = { left: 'deleted', right: 'saved', hold: 'held' } as const;
const AXIS_LOCK_PX = 10;
const DIST_X = 0.25; // 가로: 덱 폭의 25%
const DIST_Y = 0.15; // 세로: 덱 높이의 15%
const FLICK_V = 0.5; // px/ms
const FLICK_MIN_PX = 24;
// 버튼·키 연타 가드: 실수로 두 번 탭하면 React가 클릭 사이에 다시 그려 다음 카드까지 처리될 수 있다.
// 새 카드를 보고 판단하기엔 너무 짧은 간격의 두 번째 입력은 버린다. 스와이프는 제스처 자체가 구분되므로 제외.
const REPEAT_GUARD_MS = 300;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Flying = { key: string; product: Product; dir: FlyDir; from: string | null };

type Props = {
  cards: Product[];
  overlayOpen: boolean;
  onInfo: (productId: string) => void;
};

export function Deck({ cards, overlayOpen, onInfo }: Props) {
  const stackRef = useRef<HTMLDivElement>(null);
  const [flying, setFlying] = useState<Flying[]>([]);
  const top = cards[0];

  /** 스와이프·버튼·키보드 공통 경로. productId는 사용자가 본 그 카드로 고정된다. */
  const lastAt = useRef(-Infinity);
  const decide = useCallback((productId: string, dir: FlyDir, from: string | null) => {
    const now = performance.now();
    if (from === null && now - lastAt.current < REPEAT_GUARD_MS) return;
    perf.start();
    if (!store.commit(productId, NEXT_STATE[dir], { expect: ['unseen'], undoable: true })) {
      perf.cancel();
      return;
    }
    if (from === null) lastAt.current = now;
    const product = cards.find((c) => c.id === productId);
    if (product) setFlying((f) => [...f.slice(-3), { key: `${productId}:${performance.now()}`, product, dir, from }]);
    navigator.vibrate?.(10);
  }, [cards]);

  useLayoutEffect(() => {
    perf.end();
  }, [top?.id]);

  // 보이는 스택(3장) 다음 카드의 이미지를 미리 디코드
  useEffect(() => {
    for (const p of cards.slice(3, 5)) {
      const img = new Image();
      img.src = p.imageUrl;
      img.decode?.().catch(() => {});
    }
  }, [cards]);

  // 키보드: 렌더된 맨 위 카드 기준. 키 반복 입력은 무시한다.
  const topRef = useRef(top);
  topRef.current = top;
  useEffect(() => {
    if (overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      const t = topRef.current;
      if (e.key === 'z' || e.key === 'Z') {
        store.undo();
        return;
      }
      if (!t) return;
      if (e.key === 'ArrowLeft') decide(t.id, 'left', null);
      else if (e.key === 'ArrowRight') decide(t.id, 'right', null);
      else if (e.key === 'ArrowDown' || e.key === 'h' || e.key === 'H') decide(t.id, 'hold', null);
      else if (e.key === 'ArrowUp') onInfo(t.id);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOpen, decide, onInfo]);

  const removeFlying = useCallback((k: string) => setFlying((list) => list.filter((x) => x.key !== k)), []);
  const visible = cards.slice(0, 3);

  return (
    <>
      <div className="stage">
        <div className="stack" ref={stackRef}>
          {visible
            .map((p, i) => (
              <SwipeCard key={p.id} product={p} depth={i} stackRef={stackRef} onRelease={decide} onInfo={onInfo} />
            ))
            .reverse()}
          {flying.map((f) => (
            <FlyingCard key={f.key} f={f} onDone={removeFlying} />
          ))}
        </div>
      </div>
      <nav className="actions" aria-label="결정">
        <button className="act act-del" disabled={!top} onClick={() => top && decide(top.id, 'left', null)}>
          <span className="act-circle"><IconX size={28} /></span>
          <span className="act-label">삭제</span>
        </button>
        <button className="act act-hold" disabled={!top} onClick={() => top && decide(top.id, 'hold', null)}>
          <span className="act-circle"><IconPause size={22} /></span>
          <span className="act-label">보류</span>
        </button>
        <button className="act act-save" disabled={!top} onClick={() => top && decide(top.id, 'right', null)}>
          <span className="act-circle"><IconBookmark size={26} /></span>
          <span className="act-label">보관</span>
        </button>
      </nav>
    </>
  );
}

const CardBody = memo(function CardBody({ product, onInfo }: { product: Product; onInfo?: () => void }) {
  return (
    <>
      <img className="card-img" src={product.imageUrl} alt={product.title} width={600} height={800} draggable={false} />
      {product.isDummy && <span className="badge-dummy">더미 상품</span>}
      <div className="card-info">
        <div className="card-meta">
          <span className={`chip chip-${product.tradeType}`}>{TRADE_LABEL[product.tradeType]}</span>
          <span className="card-source">{product.sourceName}</span>
        </div>
        <h2 className="card-title">{product.title}</h2>
        <div className="card-bottom">
          <div className="card-price">
            {formatPrice(product)} <span className="cur">{product.currency}</span>
          </div>
          {onInfo && (
            <button className="info-btn" onClick={onInfo} aria-label="구매 정보 보기">
              <IconUp size={16} /> 구매 정보
            </button>
          )}
        </div>
        {product.sizes && (
          <div className="card-sizes" aria-label="사이즈">
            {product.sizes.map((s) => (
              <span key={s}>{s}</span>
            ))}
          </div>
        )}
      </div>
      <div className="tint tint-l" />
      <div className="tint tint-r" />
      <div className="tint tint-u" />
      <span className="stamp stamp-l">삭제</span>
      <span className="stamp stamp-r">보관</span>
      <span className="stamp stamp-u">구매 정보</span>
      <span className="stamp stamp-h">보류</span>
    </>
  );
});

type Gesture = {
  id: number;
  x0: number;
  y0: number;
  axis: 'x' | 'y' | null;
  dx: number;
  dy: number;
  grabTop: boolean;
  w: number;
  h: number;
  samples: { t: number; x: number; y: number }[];
};

/** 스택의 모든 카드는 같은 컴포넌트다 → 뒤 카드가 맨 위로 올라올 때 DOM이 유지되어 CSS 전환이 이어진다. */
function SwipeCard({
  product,
  depth,
  stackRef,
  onRelease,
  onInfo,
}: {
  product: Product;
  depth: number;
  stackRef: React.RefObject<HTMLDivElement | null>;
  onRelease: (id: string, dir: FlyDir, from: string | null) => void;
  onInfo: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const g = useRef<Gesture | null>(null);

  const paint = (dx: number, dy: number) => {
    const el = ref.current!;
    const s = g.current!;
    const rot = clamp((dx / s.w) * 16, -12, 12) * (s.grabTop ? 1 : -1);
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg)`;
    const l = clamp(-dx / (s.w * DIST_X), 0, 1);
    const r = clamp(dx / (s.w * DIST_X), 0, 1);
    const u = clamp(-dy / (s.h * DIST_Y), 0, 1);
    el.style.setProperty('--l', String(l));
    el.style.setProperty('--r', String(r));
    el.style.setProperty('--u', String(u));
    el.dataset.armed = l >= 1 ? 'l' : r >= 1 ? 'r' : u >= 1 ? 'u' : '';
    stackRef.current?.style.setProperty('--progress', String(Math.max(l, r)));
  };

  const springBack = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = reducedMotion() ? 'none' : 'transform 320ms cubic-bezier(.34,1.4,.64,1)';
    el.style.transform = '';
    for (const k of ['--l', '--r', '--u']) el.style.setProperty(k, '0');
    el.dataset.armed = '';
    stackRef.current?.style.setProperty('--progress', '0');
  };

  const end = (dragging: boolean) => {
    stackRef.current?.toggleAttribute('data-dragging', dragging);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (depth !== 0 || g.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const stack = stackRef.current!.getBoundingClientRect();
    g.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      axis: null,
      dx: 0,
      dy: 0,
      grabTop: e.clientY < r.top + r.height / 2,
      w: stack.width,
      h: stack.height,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
    };
    el.setPointerCapture(e.pointerId);
    el.style.transition = 'none';
    end(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (!s.axis) {
      if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    s.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    while (s.samples.length > 2 && e.timeStamp - s.samples[0].t > 100) s.samples.shift();
    s.dx = s.axis === 'x' ? dx : 0;
    // 아래로는 동작이 없으므로 저항을 준다
    s.dy = s.axis === 'y' ? (dy < 0 ? dy : dy * 0.2) : 0;
    paint(s.dx, s.dy);
  };

  const finish = (e: React.PointerEvent, cancelled: boolean) => {
    const s = g.current;
    if (!s || e.pointerId !== s.id) return;
    g.current = null;
    end(false);
    if (cancelled || !s.axis) return springBack();

    const first = s.samples[0];
    const last = s.samples[s.samples.length - 1];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;

    if (s.axis === 'x') {
      const far = Math.abs(s.dx) >= s.w * DIST_X;
      const flick = Math.abs(vx) >= FLICK_V && Math.sign(vx) === Math.sign(s.dx) && Math.abs(s.dx) >= FLICK_MIN_PX;
      if (far || flick) return onRelease(product.id, s.dx < 0 ? 'left' : 'right', ref.current!.style.transform);
    } else {
      const far = -s.dy >= s.h * DIST_Y;
      const flick = vy <= -FLICK_V && s.dy <= -FLICK_MIN_PX;
      if (far || flick) {
        springBack();
        return onInfo(product.id);
      }
    }
    springBack();
  };

  const isTop = depth === 0;
  return (
    <div
      ref={ref}
      className={isTop ? 'card top' : 'card'}
      style={{ '--i': depth } as React.CSSProperties}
      aria-hidden={!isTop}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
      data-testid={isTop ? 'top-card' : undefined}
      data-product-id={product.id}
    >
      <CardBody product={product} onInfo={isTop ? () => onInfo(product.id) : undefined} />
    </div>
  );
}

const FLY_TO: Record<FlyDir, string> = {
  left: 'translate3d(-150%, 4%, 0) rotate(-22deg)',
  right: 'translate3d(150%, 4%, 0) rotate(22deg)',
  hold: 'translate3d(0, 38%, 0) scale(.55)',
};

function FlyingCard({ f, onDone }: { f: Flying; onDone: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const k = f.dir === 'left' ? '--l' : f.dir === 'right' ? '--r' : '--h';
    el.style.setProperty(k, '1');
    const from = f.from || 'translate3d(0,0,0)';
    const anim = reducedMotion()
      ? el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })
      : el.animate(
          [
            { transform: from, opacity: 1 },
            { transform: FLY_TO[f.dir], opacity: f.dir === 'hold' ? 0 : 0.9 },
          ],
          { duration: f.dir === 'hold' ? 220 : 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
        );
    const done = () => onDone(f.key);
    anim.addEventListener('finish', done);
    const t = setTimeout(done, 600); // 탭 비활성 등으로 finish가 늦을 때 대비
    return () => {
      clearTimeout(t);
      anim.removeEventListener('finish', done);
    };
  }, [f, onDone]);

  return (
    <div ref={ref} className="card flying" style={{ transform: f.from || undefined }} aria-hidden>
      <CardBody product={f.product} />
    </div>
  );
}
