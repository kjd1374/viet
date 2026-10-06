import { useCallback, useEffect, useMemo, useState } from 'react';

export type View = 'deck' | 'saved' | 'held' | 'styling';
export type Route = { view: View; sheet: string | null };

type HistState = { nav?: boolean; sheet?: string } | null;

const HASH: Record<View, string> = { deck: '#/', saved: '#/saved', held: '#/held', styling: '#/styling' };

function read(): Route {
  const h = location.hash;
  const view: View = h === '#/saved' ? 'saved' : h === '#/held' ? 'held' : h === '#/styling' ? 'styling' : 'deck';
  const st = history.state as HistState;
  return { view, sheet: st?.sheet ?? null };
}

/**
 * 해시 + history.state 기반 라우팅.
 * - 구매 정보 시트는 같은 URL에 history 항목 하나를 쌓는다 → 닫기와 브라우저 뒤로가기가 모두 정확히 한 단계만 돌아간다.
 * - 시트는 화면 위의 오버레이라서 아래 화면(덱의 현재 카드, 목록)은 그대로 남는다.
 */
export function useRoute() {
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
    };
  }, []);

  const go = useCallback((view: View) => {
    if (read().view === view) return;
    history.pushState({ nav: true } satisfies HistState, '', HASH[view]);
    setRoute(read());
  }, []);

  const home = useCallback(() => {
    if ((history.state as HistState)?.nav) history.back();
    else {
      history.replaceState(null, '', HASH.deck);
      setRoute(read());
    }
  }, []);

  /** 앱 안에서 쌓은 기록이면 뒤로, 아니면(직접 진입) 지정한 화면으로 교체 */
  const back = useCallback((fallback: View) => {
    if ((history.state as HistState)?.nav) history.back();
    else {
      history.replaceState(null, '', HASH[fallback]);
      setRoute(read());
    }
  }, []);

  const openSheet = useCallback((productId: string) => {
    const st = history.state as HistState;
    if (st?.sheet) return;
    history.pushState({ ...st, sheet: productId } satisfies HistState, '', location.href);
    setRoute(read());
  }, []);

  const closeSheet = useCallback(() => {
    if ((history.state as HistState)?.sheet) history.back();
    else setRoute((r) => ({ ...r, sheet: null }));
  }, []);

  return useMemo(() => ({ route, go, home, back, openSheet, closeSheet }), [route, go, home, back, openSheet, closeSheet]);
}
