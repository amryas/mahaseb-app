import '@testing-library/jest-dom';

// تخزين مؤقت للاختبارات
const storage = {};
beforeEach(() => {
  Object.keys(storage).forEach((k) => delete storage[k]);
  Object.defineProperty(global, 'localStorage', {
    value: {
      getItem: (k) => storage[k] ?? null,
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
      clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
      length: 0,
      key: () => null,
    },
    writable: true,
  });
});
