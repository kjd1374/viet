import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Ack, DecisionState, PendingAction, RemoteAdapter } from './types';

// 개발·검증용 모의 서버. 실제 서버가 아니며, 브라우저 안의 별도 IndexedDB에 "서버 상태"를 흉내 낸다.
// 지연·실패·응답 유실·오프라인을 주입해 큐가 카드 전환을 막지 않는지, 재시도가 중복 적용되지 않는지 검증한다.

export type Faults = {
  delayMs: number;
  /** 서버가 처리하기 전에 실패 */
  failBefore: boolean;
  /** 서버는 처리했지만 응답이 유실됨 (타임아웃 뒤 이미 처리된 경우) */
  dropResponse: boolean;
  offline: boolean;
  /** 기기 내 저장 자체 실패 */
  localFail: boolean;
};

export const NO_FAULTS: Faults = { delayMs: 0, failBefore: false, dropResponse: false, offline: false, localFail: false };

interface ServerDB extends DBSchema {
  applied: { key: string; value: Ack };
  records: { key: [string, string]; value: { scopeId: string; productId: string; state: DecisionState; revision: number } };
}

export type ServerStats = { calls: number; applied: number; duplicates: number; stale: number };

export class MockServer implements RemoteAdapter {
  stats: ServerStats = { calls: 0, applied: 0, duplicates: 0, stale: 0 };
  private dbp: Promise<IDBPDatabase<ServerDB>> | null = null;

  constructor(
    private getFaults: () => Faults,
    private dbName = 'viet-mock-server',
  ) {}

  private db() {
    return (this.dbp ??= openDB<ServerDB>(this.dbName, 1, {
      upgrade(d) {
        d.createObjectStore('applied', { keyPath: 'actionId' });
        d.createObjectStore('records', { keyPath: ['scopeId', 'productId'] });
      },
    }));
  }

  async apply(action: PendingAction): Promise<Ack> {
    const f = this.getFaults();
    this.stats.calls++;
    if (f.offline) throw new Error('offline');
    if (f.delayMs > 0) await new Promise((r) => setTimeout(r, f.delayMs));
    if (f.failBefore) throw new Error('server 500');

    const d = await this.db();
    // 확인과 기록을 하나의 readwrite 트랜잭션에서 수행 → 같은 actionId가 동시에 와도 한 번만 적용된다.
    const tx = d.transaction(['applied', 'records'], 'readwrite');
    const prior = await tx.objectStore('applied').get(action.actionId);
    let ack: Ack;
    if (prior) {
      this.stats.duplicates++;
      ack = { ...prior, duplicate: true };
    } else {
      const rec = await tx.objectStore('records').get([action.scopeId, action.productId]);
      if (!rec || rec.revision < action.localRevision) {
        await tx.objectStore('records').put({
          scopeId: action.scopeId,
          productId: action.productId,
          state: action.targetState,
          revision: action.localRevision,
        });
        this.stats.applied++;
      } else {
        // 더 최신 버전이 이미 있음 → 덮어쓰지 않는다.
        this.stats.stale++;
      }
      ack = {
        actionId: action.actionId,
        productId: action.productId,
        appliedRevision: Math.max(rec?.revision ?? 0, action.localRevision),
        duplicate: false,
      };
      await tx.objectStore('applied').put(ack);
    }
    await tx.done;
    if (f.dropResponse) throw new Error('response lost');
    return ack;
  }

  /** 테스트 확인용 */
  async readRecord(scopeId: string, productId: string) {
    return (await this.db()).get('records', [scopeId, productId]);
  }
}

const FAULT_KEY = 'viet-dev-faults';

export function loadFaults(): Faults {
  try {
    const raw = localStorage.getItem(FAULT_KEY);
    if (raw) return { ...NO_FAULTS, ...JSON.parse(raw) };
  } catch {
    /* 저장소 접근 불가 시 기본값 */
  }
  return { ...NO_FAULTS };
}

export function saveFaults(f: Faults) {
  try {
    localStorage.setItem(FAULT_KEY, JSON.stringify(f));
  } catch {
    /* 무시: 개발용 편의 설정 */
  }
}
