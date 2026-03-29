import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  upsertEntityRecord: vi.fn(() => Promise.resolve()),
  deleteEntityRecord: vi.fn(() => Promise.resolve()),
  getEntityRecordById: vi.fn(() => Promise.resolve(null)),
  addToSyncQueue: vi.fn(() => Promise.resolve()),
}));

vi.mock('./workspaceApi', () => ({
  isWorkspaceSaaSEnabled: () => true,
}));

vi.mock('./subscriptionWriteGuard', () => ({
  assertWriteAllowedEntity: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('./indexedDbStore', () => ({
  upsertEntityRecord: (...a) => hoisted.upsertEntityRecord(...a),
  deleteEntityRecord: (...a) => hoisted.deleteEntityRecord(...a),
  getEntityRecordById: (...a) => hoisted.getEntityRecordById(...a),
}));

vi.mock('./syncQueue', () => ({
  addToSyncQueue: (...a) => hoisted.addToSyncQueue(...a),
  processSyncQueue: vi.fn(() => Promise.resolve()),
}));

vi.mock('./syncQueueFlush', () => ({
  requestSyncQueueFlush: vi.fn(),
}));

vi.mock('../services/monitoring', () => ({
  logSystemEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('./store', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProducts: vi.fn(() => []),
  };
});

import { addProduct, updateProduct, deleteProduct } from './productsWriteService';
import { OP } from './operationTypes';

describe('productsWriteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('mahaseb_current_account', 'ws-p1');
    if (typeof globalThis.indexedDB === 'undefined') {
      globalThis.indexedDB = /** @type {IDBFactory} */ ({});
    }
  });

  it('addProduct upserts IDB and enqueues insert_product', async () => {
    const r = await addProduct({ name: 'تجربة', quantity: 1, minQuantity: 0, unit: 'قطعة', costPrice: 0 });
    expect(r.ok).toBe(true);
    expect(hoisted.upsertEntityRecord).toHaveBeenCalledWith('products', 'ws-p1', expect.any(String), expect.objectContaining({ name: 'تجربة' }));
    expect(hoisted.addToSyncQueue).toHaveBeenCalledWith(
      OP.INSERT_PRODUCT,
      'ws-p1',
      expect.any(Object),
      expect.objectContaining({ maxRetry: 5, skipLocalWrite: true, skipSubscriptionGuard: true })
    );
  });

  it('updateProduct enqueues update_product', async () => {
    hoisted.getEntityRecordById.mockResolvedValueOnce({ id: 'p1', name: 'قديم', quantity: 5 });
    const r = await updateProduct('p1', { name: 'جديد' });
    expect(r.ok).toBe(true);
    expect(hoisted.addToSyncQueue).toHaveBeenCalledWith(
      OP.UPDATE_PRODUCT,
      'ws-p1',
      { id: 'p1', updates: { name: 'جديد' } },
      expect.objectContaining({ skipLocalWrite: true, skipSubscriptionGuard: true })
    );
  });

  it('deleteProduct enqueues delete_product', async () => {
    const r = await deleteProduct('p9');
    expect(r.ok).toBe(true);
    expect(hoisted.deleteEntityRecord).toHaveBeenCalledWith('products', 'ws-p1', expect.any(String), 'p9');
    expect(hoisted.addToSyncQueue).toHaveBeenCalledWith(
      OP.DELETE_PRODUCT,
      'ws-p1',
      { productId: 'p9' },
      expect.objectContaining({ skipLocalWrite: true, skipSubscriptionGuard: true })
    );
  });
});
