import type { LocalStore, PendingAction, RemoteAdapter } from './types';

export type SyncStatus = {
  pending: number;
  failing: boolean;
  offline: boolean;
  lastError?: string;
  nextRetryAt?: number;
};

type Options = {
  timeoutMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  isOnline: () => boolean;
};

const DEFAULTS: Options = {
  timeoutMs: 5000,
  baseBackoffMs: 1000,
  maxBackoffMs: 15000,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * 배경 동기화 큐.
 * - 화면 전환은 이 큐를 기다리지 않는다. 큐는 이미 로컬에 기록된 작업만 보낸다.
 * - 생성 순서(FIFO)로 하나씩 보내므로 상품별 순서가 보장된다.
 * - 실패 시 같은 actionId로 재시도한다. 서버가 actionId로 중복을 막는다.
 * - 서버 응답은 큐에서 작업을 지울 뿐 화면 상태를 바꾸지 않는다 → 늦은 응답이 최신 선택을 덮어쓸 수 없다.
 */
export class SyncQueue {
  private queue: PendingAction[] = [];
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private opts: Options;
  status: SyncStatus = { pending: 0, failing: false, offline: false };

  constructor(
    private local: LocalStore,
    private remote: RemoteAdapter,
    private onStatus: (s: SyncStatus) => void,
    opts: Partial<Options> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  restore(actions: PendingAction[]) {
    this.queue = [...actions];
    this.emit({});
    void this.kick();
  }

  enqueue(action: PendingAction) {
    this.queue.push(action);
    this.emit({});
    void this.kick();
  }

  retryNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.kick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 테스트용: 큐가 빌 때까지(또는 실패로 멈출 때까지) 대기 */
  async idle() {
    while (this.running) await new Promise((r) => setTimeout(r, 5));
  }

  private emit(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch, pending: this.queue.length };
    this.onStatus(this.status);
  }

  private async kick() {
    if (this.running || this.stopped || this.timer) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) {
        if (!this.opts.isOnline()) {
          this.emit({ offline: true });
          return;
        }
        const head = this.queue[0];
        try {
          await withTimeout(this.remote.apply(head), this.opts.timeoutMs);
          await this.local.removePending(head.actionId).catch(() => {
            /* 다음 실행에서 다시 보내도 서버가 중복을 막는다 */
          });
          this.queue.shift();
          this.emit({ failing: false, offline: false, lastError: undefined, nextRetryAt: undefined });
        } catch (e) {
          head.retryCount++;
          head.lastError = e instanceof Error ? e.message : String(e);
          void this.local.updatePending({ ...head }).catch(() => {});
          const delay = Math.min(this.opts.baseBackoffMs * 2 ** (head.retryCount - 1), this.opts.maxBackoffMs);
          this.emit({ failing: true, offline: head.lastError === 'offline', lastError: head.lastError, nextRetryAt: Date.now() + delay });
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.kick();
          }, delay);
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }
}
