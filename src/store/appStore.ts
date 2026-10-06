import { PRODUCTS, type Product } from '../data/products';
import { EMPTY_OUTFIT, isOutfit, type Outfit } from './outfit';
import { SyncQueue, type SyncStatus } from './sync';
import type { Decision, DecisionState, LocalStore, PendingAction, RemoteAdapter } from './types';

export type UndoEntry = { id: number; productId: string; prev: DecisionState; next: DecisionState };
export type AppError = { id: number; message: string; retry?: () => void };

export type AppState = {
  ready: boolean;
  loadError: string | null;
  decisions: Readonly<Record<string, Decision>>;
  guideHidden: boolean;
  outfit: Outfit;
  sync: SyncStatus;
  undo: UndoEntry | null;
  error: AppError | null;
};

export type CommitOptions = {
  /** 이 상태일 때만 적용. 이미 처리된 카드의 늦은 이벤트를 무시하기 위한 가드. */
  expect?: readonly DecisionState[];
  undoable?: boolean;
};

let seq = 0;

/** 보안 컨텍스트가 아닌 http://192.168.x.x 에서도 동작하도록 randomUUID에 의존하지 않는다. */
export function newActionId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export class AppStore {
  private state: AppState = {
    ready: false,
    loadError: null,
    decisions: {},
    guideHidden: false,
    outfit: EMPTY_OUTFIT,
    sync: { pending: 0, failing: false, offline: false },
    undo: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private writeChain: Promise<void> = Promise.resolve();
  readonly sync: SyncQueue;

  constructor(
    private local: LocalStore,
    remote: RemoteAdapter,
    readonly scopeId: string,
    syncOpts?: ConstructorParameters<typeof SyncQueue>[3],
  ) {
    this.sync = new SyncQueue(local, remote, (s) => this.set({ sync: s }), syncOpts);
  }

  getState = (): AppState => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  async init() {
    try {
      const snap = await this.local.load(this.scopeId);
      const decisions: Record<string, Decision> = {};
      for (const d of snap.decisions) decisions[d.productId] = d;
      this.set({
        ready: true,
        decisions,
        guideHidden: snap.meta.guideHidden,
        outfit: isOutfit(snap.meta.outfit) ? snap.meta.outfit : EMPTY_OUTFIT,
      });
      this.sync.restore(snap.pending);
    } catch (e) {
      this.set({ loadError: e instanceof Error ? e.message : String(e) });
    }
  }

  stateOf(productId: string): DecisionState {
    return this.state.decisions[productId]?.state ?? 'unseen';
  }

  /**
   * 모든 결정(스와이프·버튼·키보드·목록)이 지나가는 단일 경로.
   * 화면은 즉시 전환하고, 기기 저장은 직렬 체인으로 원자 기록한다.
   * 기기 저장이 실패하면 해당 결정을 되돌리고 재시도 가능한 오류를 띄운다.
   */
  commit(productId: string, next: DecisionState, opts: CommitOptions = {}): boolean {
    const cur = this.state.decisions[productId];
    const curState = cur?.state ?? 'unseen';
    if (opts.expect && !opts.expect.includes(curState)) return false;
    if (curState === next) return false;

    const rev = (cur?.localRevision ?? 0) + 1;
    const now = Date.now();
    const decision: Decision = { scopeId: this.scopeId, productId, state: next, localRevision: rev, updatedAt: now };
    const action: PendingAction = {
      actionId: newActionId(),
      scopeId: this.scopeId,
      productId,
      targetState: next,
      localRevision: rev,
      createdAt: now,
      retryCount: 0,
    };

    this.set({
      decisions: { ...this.state.decisions, [productId]: decision },
      undo: opts.undoable ? { id: ++seq, productId, prev: curState, next } : this.state.undo,
      error: null,
    });

    this.writeChain = this.writeChain
      .then(() => this.local.commit(decision, action))
      .then(
        () => this.sync.enqueue(action),
        () => {
          if (this.state.decisions[productId]?.localRevision !== rev) return;
          const decisions = { ...this.state.decisions };
          if (cur) decisions[productId] = cur;
          else delete decisions[productId];
          this.set({
            decisions,
            undo: this.state.undo?.productId === productId ? null : this.state.undo,
            error: {
              id: ++seq,
              message: '기기에 저장하지 못해 선택을 되돌렸어요.',
              retry: () => this.commit(productId, next, { ...opts, expect: [curState] }),
            },
          });
        },
      );
    return true;
  }

  undo() {
    const u = this.state.undo;
    if (!u) return false;
    this.set({ undo: null });
    return this.commit(u.productId, u.prev, { expect: [u.next] });
  }

  clearUndo(id: number) {
    if (this.state.undo?.id === id) this.set({ undo: null });
  }

  dismissError() {
    this.set({ error: null });
  }

  setGuideHidden(hidden: boolean) {
    if (this.state.guideHidden === hidden) return;
    this.set({ guideHidden: hidden });
    this.saveMeta();
  }

  setOutfit(outfit: Outfit) {
    this.set({ outfit });
    this.saveMeta();
  }

  private saveMeta() {
    const { guideHidden, outfit } = this.state;
    void this.local.setMeta({ scopeId: this.scopeId, guideHidden, outfit }).catch(() => {});
  }

  /** 테스트용: 대기 중인 기기 저장이 끝날 때까지 */
  flush() {
    return this.writeChain;
  }
}

export function deckOf(decisions: AppState['decisions']): Product[] {
  return PRODUCTS.filter((p) => (decisions[p.id]?.state ?? 'unseen') === 'unseen');
}

export function listOf(decisions: AppState['decisions'], state: 'saved' | 'held'): Product[] {
  return PRODUCTS.filter((p) => decisions[p.id]?.state === state).sort(
    (a, b) => decisions[b.id].updatedAt - decisions[a.id].updatedAt || b.id.localeCompare(a.id),
  );
}

export function countOf(decisions: AppState['decisions'], state: DecisionState): number {
  let n = 0;
  for (const p of PRODUCTS) if ((decisions[p.id]?.state ?? 'unseen') === state) n++;
  return n;
}
