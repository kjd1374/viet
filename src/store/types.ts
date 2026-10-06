export type DecisionState = 'unseen' | 'saved' | 'held' | 'deleted';

export type Decision = {
  scopeId: string;
  productId: string;
  state: DecisionState;
  localRevision: number;
  updatedAt: number;
};

/** 서버(현재는 모의 서버)로 보낼 작업. 결정과 같은 트랜잭션으로 기록된다. */
export type PendingAction = {
  actionId: string;
  scopeId: string;
  productId: string;
  targetState: DecisionState;
  localRevision: number;
  createdAt: number;
  retryCount: number;
  lastError?: string;
};

export type Meta = {
  scopeId: string;
  guideHidden: boolean;
  /** 코디 화면의 현재 착장 (슬롯별 상품 ID) */
  outfit?: { top: string | null; bottom: string | null; dress: string | null; outer: string | null };
};

export type Snapshot = {
  decisions: Decision[];
  pending: PendingAction[];
  meta: Meta;
};

/** 기기 내 영속 저장소. 결정과 보낼 작업을 원자적으로 기록한다. */
export interface LocalStore {
  load(scopeId: string): Promise<Snapshot>;
  commit(decision: Decision, action: PendingAction): Promise<void>;
  updatePending(action: PendingAction): Promise<void>;
  removePending(actionId: string): Promise<void>;
  setMeta(meta: Meta): Promise<void>;
}

/** 서버 확인 응답. 전체 목록이 아니라 처리 결과만 돌려받는다. */
export type Ack = {
  actionId: string;
  productId: string;
  appliedRevision: number;
  duplicate: boolean;
};

export interface RemoteAdapter {
  apply(action: PendingAction): Promise<Ack>;
}

export const LOCAL_SCOPE = 'local-demo';
