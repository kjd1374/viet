import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppState } from '../store/appStore';
import { getFaults, server, setFaults, store } from '../store/instance';
import { perf } from '../perf';
import { IconUndo } from './Icons';

const UNDO_TEXT = { deleted: '삭제했어요', saved: '보관함에 저장했어요', held: '보류 목록으로 옮겼어요', unseen: '되돌렸어요' };

export function Toasts({ undo, error }: Pick<AppState, 'undo' | 'error'>) {
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => store.clearUndo(undo.id), 3000);
    return () => clearTimeout(t);
  }, [undo]);

  return (
    <div className="toasts" aria-live="polite">
      {error ? (
        <div className="toast toast-error" role="alert" key={error.id}>
          <span>{error.message}</span>
          {error.retry && (
            <button className="toast-btn" onClick={() => error.retry!()}>다시 시도</button>
          )}
          <button className="toast-btn subtle" onClick={() => store.dismissError()} aria-label="닫기">✕</button>
        </div>
      ) : undo ? (
        <div className="toast" key={undo.id}>
          <span>{UNDO_TEXT[undo.next]}</span>
          <button className="toast-btn" onClick={() => store.undo()}>
            <IconUndo size={16} /> 되돌리기
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 동기화 상태는 문제가 있거나 오래 걸릴 때만 작게 표시한다. 실제 서버가 아니므로 "모의 서버"라고 밝힌다. */
export function SyncBadge({ sync }: Pick<AppState, 'sync'>) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (sync.pending === 0) return setSlow(false);
    const t = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(t);
  }, [sync.pending > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sync.offline)
    return (
      <span className="sync sync-off" role="status">오프라인 · {sync.pending}건 대기</span>
    );
  if (sync.failing)
    return (
      <button className="sync sync-fail" onClick={() => store.sync.retryNow()} title={sync.lastError}>
        모의 서버 전송 실패 · 재시도
      </button>
    );
  if (sync.pending > 0 && slow)
    return (
      <span className="sync" role="status">모의 서버 전송 중 {sync.pending}</span>
    );
  return null;
}

export function DevPanel({ sync }: Pick<AppState, 'sync'>) {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const stats = useSyncExternalStore(perf.subscribe, () => perfKey());
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [open]);
  const f = getFaults();
  const p = JSON.parse(stats) as ReturnType<typeof perf.stats>;
  const s = server.stats;

  return (
    <div className={open ? 'dev open' : 'dev'}>
      <button className="dev-pill" onClick={() => setOpen(!open)}>DEV</button>
      {open && (
        <div className="dev-body">
          <label>
            서버 지연
            <select value={f.delayMs} onChange={(e) => (setFaults({ delayMs: Number(e.target.value) }), force((x) => x + 1))}>
              <option value={0}>0ms</option>
              <option value={2000}>2000ms</option>
              <option value={6000}>6000ms (타임아웃)</option>
            </select>
          </label>
          {(
            [
              ['failBefore', '서버 실패 (처리 전)'],
              ['dropResponse', '응답 유실 (처리 후)'],
              ['offline', '오프라인'],
              ['localFail', '기기 저장 실패'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              <input type="checkbox" checked={f[k]} onChange={(e) => (setFaults({ [k]: e.target.checked }), force((x) => x + 1))} />
              {label}
            </label>
          ))}
          <div className="dev-stats">
            <div>카드 전환 n={p.n} p50={p.p50.toFixed(1)} p95={p.p95.toFixed(1)} max={p.max.toFixed(1)}ms</div>
            <div>대기 {sync.pending} · 실패 {sync.failing ? 'Y' : 'N'} {sync.lastError ?? ''}</div>
            <div>모의 서버 호출 {s.calls} · 적용 {s.applied} · 중복 차단 {s.duplicates} · 구버전 {s.stale}</div>
          </div>
          <button className="btn-text" onClick={() => perf.reset()}>측정 초기화</button>
        </div>
      )}
    </div>
  );
}

let lastKey = '';
let lastN = -1;
function perfKey() {
  const st = perf.stats();
  if (st.n !== lastN) {
    lastN = st.n;
    lastKey = JSON.stringify(st);
  }
  return lastKey;
}
