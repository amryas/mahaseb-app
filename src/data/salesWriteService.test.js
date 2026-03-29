import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  putSaleRecord: vi.fn(() => Promise.resolve()),
  getEntityRecordById: vi.fn(() => Promise.resolve(null)),
  deleteEntityRecord: vi.fn(() => Promise.resolve()),
  addToSyncQueue: vi.fn(() => Promise.resolve()),
  processSyncQueue: vi.fn(() => Promise.resolve()),
}));

vi.mock('./workspaceApi', () => ({
  isWorkspaceSaaSEnabled: () => false,
}));

vi.mock('./indexedDbStore', () => ({
  putSaleRecord: (...a) => hoisted.putSaleRecord(...a),
  getEntityRecordById: (...a) => hoisted.getEntityRecordById(...a),
  deleteEntityRecord: (...a) => hoisted.deleteEntityRecord(...a),
}));

vi.mock('./syncQueue', () => ({
  addToSyncQueue: (...a) => hoisted.addToSyncQueue(...a),
  processSyncQueue: (...a) => hoisted.processSyncQueue(...a),
}));

vi.mock('../services/monitoring', () => ({
  logSystemEvent: vi.fn(() => Promise.resolve()),
}));

import { addSale, updateSale, deleteSale, importSalesInChunks } from './salesWriteService';
import { SALE_QUEUE } from './saleQueueTypes';

describe('salesWriteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('mahaseb_current_account', 'ws-test-1');
    // jsdom may omit IndexedDB; service only gates on presence for add/update/delete paths.
    if (typeof globalThis.indexedDB === 'undefined') {
      globalThis.indexedDB = /** @type {IDBFactory} */ ({});
    }
  });

  it('addSale rejects invalid payload without touching IDB', async () => {
    const r = await addSale(null);
    expect(r).toEqual({ ok: false, error: 'invalid' });
    expect(hoisted.putSaleRecord).not.toHaveBeenCalled();
  });

  it('addSale returns no_workspace when account missing', async () => {
    localStorage.removeItem('mahaseb_current_account');
    const r = await addSale({ productName: 'x', quantity: 1, total: 1, date: '2025-01-01' });
    expect(r).toEqual({ ok: false, error: 'no_workspace' });
    expect(hoisted.putSaleRecord).not.toHaveBeenCalled();
  });

  it('addSale writes one record and enqueues SALE_CREATE', async () => {
    const sale = { productName: 'ب', quantity: 2, total: 20, date: '2025-06-01' };
    const r = await addSale(sale);
    expect(r.ok).toBe(true);
    expect(hoisted.putSaleRecord).toHaveBeenCalledTimes(1);
    const [wid, uid, rec] = hoisted.putSaleRecord.mock.calls[0];
    expect(wid).toBe('ws-test-1');
    expect(typeof uid).toBe('string');
    expect(rec.syncStatus).toBe('pending');
    expect(rec.productName).toBe('ب');
    expect(hoisted.addToSyncQueue).toHaveBeenCalledWith(
      SALE_QUEUE.CREATE,
      'ws-test-1',
      expect.objectContaining({ sale: expect.objectContaining({ id: rec.id }) }),
      expect.objectContaining({ maxRetry: 5, skipLocalWrite: true })
    );
  });

  it('updateSale merges and enqueues SALE_UPDATE', async () => {
    hoisted.getEntityRecordById.mockResolvedValueOnce({ id: 's1', total: 5 });
    const r = await updateSale('s1', { status: 'cancelled' });
    expect(r.ok).toBe(true);
    expect(hoisted.putSaleRecord).toHaveBeenCalled();
    expect(hoisted.addToSyncQueue).toHaveBeenCalledWith(
      SALE_QUEUE.UPDATE,
      'ws-test-1',
      { id: 's1', patch: { status: 'cancelled' } },
      expect.objectContaining({ maxRetry: 5, skipLocalWrite: true })
    );
  });

  it('deleteSale removes locally and enqueues SALE_DELETE', async () => {
    const r = await deleteSale('del-1');
    expect(r.ok).toBe(true);
    expect(hoisted.deleteEntityRecord).toHaveBeenCalledWith('sales', 'ws-test-1', expect.any(String), 'del-1');
    expect(hoisted.addToSyncQueue).toHaveBeenCalledWith(
      SALE_QUEUE.DELETE,
      'ws-test-1',
      { id: 'del-1' },
      expect.objectContaining({ maxRetry: 5, skipLocalWrite: true })
    );
  });

  it('importSalesInChunks respects cancellation and progress', async () => {
    const ac = new AbortController();
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `imp-${i}`,
      productName: 'i',
      quantity: 1,
      total: 1,
      date: '2025-01-01',
    }));
    const progress = [];
    const p = importSalesInChunks(rows, {
      chunkSize: 2,
      onProgress: (x) => progress.push(x),
      signal: ac.signal,
    });
    ac.abort();
    const res = await p;
    expect(res.aborted).toBe(true);
    expect(res.imported).toBeLessThan(5);
    expect(progress.length).toBe(res.imported);
  });
});
