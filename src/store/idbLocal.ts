import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Decision, LocalStore, Meta, PendingAction, Snapshot } from './types';

interface LocalDB extends DBSchema {
  decisions: { key: [string, string]; value: Decision; indexes: { byScope: string } };
  pending: { key: string; value: PendingAction; indexes: { byScope: string } };
  meta: { key: string; value: Meta };
}

export function createIdbLocalStore(dbName = 'viet-swipe'): LocalStore {
  let dbp: Promise<IDBPDatabase<LocalDB>> | null = null;
  const db = () =>
    (dbp ??= openDB<LocalDB>(dbName, 1, {
      upgrade(d) {
        d.createObjectStore('decisions', { keyPath: ['scopeId', 'productId'] }).createIndex('byScope', 'scopeId');
        d.createObjectStore('pending', { keyPath: 'actionId' }).createIndex('byScope', 'scopeId');
        d.createObjectStore('meta', { keyPath: 'scopeId' });
      },
    }));

  return {
    async load(scopeId): Promise<Snapshot> {
      const d = await db();
      const tx = d.transaction(['decisions', 'pending', 'meta'], 'readonly');
      const [decisions, pending, meta] = await Promise.all([
        tx.objectStore('decisions').index('byScope').getAll(scopeId),
        tx.objectStore('pending').index('byScope').getAll(scopeId),
        tx.objectStore('meta').get(scopeId),
      ]);
      await tx.done;
      pending.sort((a, b) => a.createdAt - b.createdAt || a.actionId.localeCompare(b.actionId));
      return { decisions, pending, meta: meta ?? { scopeId, guideHidden: false } };
    },

    async commit(decision, action) {
      const d = await db();
      const tx = d.transaction(['decisions', 'pending'], 'readwrite');
      await Promise.all([tx.objectStore('decisions').put(decision), tx.objectStore('pending').put(action), tx.done]);
    },

    async updatePending(action) {
      const d = await db();
      // 이미 확인되어 삭제된 작업은 되살리지 않는다.
      const tx = d.transaction('pending', 'readwrite');
      if (await tx.store.get(action.actionId)) await tx.store.put(action);
      await tx.done;
    },

    async removePending(actionId) {
      await (await db()).delete('pending', actionId);
    },

    async setMeta(meta) {
      await (await db()).put('meta', meta);
    },
  };
}

/** 개발용: 기기 저장 실패를 주입한다. */
export function withLocalFaults(inner: LocalStore, shouldFail: () => boolean): LocalStore {
  return {
    ...inner,
    commit: (d, a) => (shouldFail() ? Promise.reject(new Error('local write failed')) : inner.commit(d, a)),
  };
}
