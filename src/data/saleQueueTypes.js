/**
 * @readonly
 * Operation types for the sales write-through queue (persisted in IndexedDB sync_queue).
 * @typedef {'SALE_CREATE'|'SALE_UPDATE'|'SALE_DELETE'} SaleQueueType
 */
export const SALE_QUEUE = Object.freeze({
  CREATE: 'SALE_CREATE',
  UPDATE: 'SALE_UPDATE',
  DELETE: 'SALE_DELETE',
});

/** @type {number} */
export const SALE_QUEUE_MAX_RETRIES = 5;
