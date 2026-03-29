/**
 * تجميع المزامنة (Debounce) لتقليل طلبات السحابة — يدعم آلاف المستخدمين النشطين.
 * كل تغييرات لنفس المفتاح خلال 2.5 ثانية تُدمج في طلب مزامنة واحد.
 */
const DEBOUNCE_MS = 2500;
const pending = new Map();

function key(accountId, suffix) {
  return `${accountId}:${suffix}`;
}

export function createDebouncedSync(onSync) {
  return function debouncedSync(accountId, suffix, data) {
    const k = key(accountId, suffix);
    const entry = pending.get(k) || {};
    if (entry.timer) clearTimeout(entry.timer);
    entry.data = data;
    entry.timer = setTimeout(() => {
      pending.delete(k);
      onSync(accountId, suffix, entry.data);
    }, DEBOUNCE_MS);
    pending.set(k, entry);
  };
}
