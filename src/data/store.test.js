import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSales,
  saveSales,
  getProducts,
  saveProducts,
  getTransactions,
  saveTransactions,
  getSettings,
  saveSettings,
  getCategories,
  formatCurrency,
  formatDate,
  normalizePhoneForWhatsApp,
} from './store';

describe('store', () => {
  beforeEach(() => {
    localStorage.setItem('mahaseb_current_account', 'test-account-1');
  });

  describe('formatCurrency', () => {
    it('formats number and appends ج.م', () => {
      const out = formatCurrency(100);
      expect(out).toContain('ج.م');
      expect(out.length).toBeGreaterThan(3);
      expect(formatCurrency(0)).toContain('ج.م');
      expect(formatCurrency(99.5)).toContain('ج.م');
    });
  });

  describe('formatDate', () => {
    it('formats date string in Arabic', () => {
      const result = formatDate('2025-01-15');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('normalizePhoneForWhatsApp', () => {
    it('adds 20 prefix for Egyptian numbers', () => {
      expect(normalizePhoneForWhatsApp('01234567890')).toMatch(/^20/);
      expect(normalizePhoneForWhatsApp('01234567890')).toContain('1234567890');
    });
    it('strips non-digits', () => {
      expect(normalizePhoneForWhatsApp('01-234-567-890')).toMatch(/^\d+$/);
    });
  });

  describe('sales', () => {
    it('getSales returns array', () => {
      expect(Array.isArray(getSales())).toBe(true);
    });

    it('saveSales and getSales roundtrip', () => {
      const list = [
        { id: '1', total: 100, date: '2025-01-01', productName: 'أ', quantity: 1, status: 'completed' },
      ];
      saveSales(list);
      const read = getSales();
      expect(read).toHaveLength(1);
      expect(read[0].total).toBe(100);
      expect(read[0].productName).toBe('أ');
    });
  });

  describe('products', () => {
    it('getProducts returns array', () => {
      expect(Array.isArray(getProducts())).toBe(true);
    });

    it('saveProducts and getProducts roundtrip', () => {
      const list = [{ id: 'p1', name: 'منتج تجريبي', quantity: 10 }];
      saveProducts(list);
      const read = getProducts();
      expect(read).toHaveLength(1);
      expect(read[0].name).toBe('منتج تجريبي');
    });
  });

  describe('transactions', () => {
    it('getTransactions returns array', () => {
      expect(Array.isArray(getTransactions())).toBe(true);
    });

    it('saveTransactions and getTransactions roundtrip', () => {
      const list = [{ id: 't1', type: 'income', amount: 50, description: 'بيع', date: '2025-01-01', category: 'مبيعات' }];
      saveTransactions(list);
      const read = getTransactions();
      expect(read).toHaveLength(1);
      expect(read[0].type).toBe('income');
      expect(read[0].amount).toBe(50);
    });
  });

  describe('settings', () => {
    it('getSettings returns object with defaults', () => {
      const s = getSettings();
      expect(typeof s).toBe('object');
      expect(s).toHaveProperty('companyName');
      expect(s).toHaveProperty('defaultProfitMargin');
    });

    it('saveSettings and getSettings roundtrip', () => {
      const prev = getSettings();
      saveSettings({ ...prev, companyName: 'شركة تجريبية' });
      expect(getSettings().companyName).toBe('شركة تجريبية');
    });
  });

  describe('getCategories', () => {
    it('returns income and expense arrays', () => {
      const cats = getCategories();
      expect(Array.isArray(cats.income)).toBe(true);
      expect(Array.isArray(cats.expense)).toBe(true);
      expect(cats.income).toContain('مبيعات');
      expect(cats.expense).toContain('مرتجع');
    });
  });
});
