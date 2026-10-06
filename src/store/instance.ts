import { useSyncExternalStore } from 'react';
import { AppStore, type AppState } from './appStore';
import { createIdbLocalStore, withLocalFaults } from './idbLocal';
import { loadFaults, MockServer, NO_FAULTS, saveFaults, type Faults } from './mockServer';
import { LOCAL_SCOPE } from './types';

/** ?dev 로 열면 지연·실패 주입 패널이 켜진다. 일반 모드에서는 주입이 항상 꺼져 있다. */
export const DEV = typeof location !== 'undefined' && new URLSearchParams(location.search).has('dev');

const faults: Faults = DEV ? loadFaults() : { ...NO_FAULTS };
export const getFaults = (): Faults => faults;
export function setFaults(patch: Partial<Faults>) {
  const wasOffline = faults.offline;
  Object.assign(faults, patch);
  saveFaults(faults);
  // 오프라인 해제만 실제 online 이벤트처럼 즉시 재개한다. 서버 장애 해제는 백오프 재시도나 사용자의 재시도 버튼으로 복구된다.
  if (wasOffline && !faults.offline) store.sync.retryNow();
}

export const server = new MockServer(getFaults);
export const store = new AppStore(
  withLocalFaults(createIdbLocalStore(), () => faults.localFail),
  server,
  LOCAL_SCOPE,
);

void store.init();
window.addEventListener('online', () => store.sync.retryNow());
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) store.sync.retryNow();
});

export function useApp(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState);
}

// 자동화·디버깅용
Object.assign(window, { __store: store, __server: server, __setFaults: setFaults });
