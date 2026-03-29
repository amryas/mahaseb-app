import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSummaryReport, buildInvoiceMessage } from './whatsappReport';

vi.mock('../data/store', () => ({
  formatCurrency: (n) => n + ' ج.م',
  formatDate: (d) => d,
  getSettings: () => ({ companyName: 'مشروع تجريبي' }),
  getSales: () => [
    { id: '1', total: 100, date: '2025-01-01', status: 'completed' },
    { id: '2', total: 200, date: '2025-01-01', status: 'completed' },
  ],
  getSaleTotal: (s) => Number(s?.total) || 0,
  getSaleProfit: (s) => Number(s?.profit) ?? 0,
  getSaleSummary: (s) => (s?.productName ? `${s.productName} × ${s.quantity || 0}` : '—'),
}));

describe('whatsappReport', () => {
  describe('buildSummaryReport', () => {
    it('returns string containing company and sales', () => {
      const transactions = [
        { type: 'income', amount: 300, date: '2025-01-01' },
        { type: 'expense', amount: 50, date: '2025-01-01' },
      ];
      const text = buildSummaryReport(transactions, []);
      expect(typeof text).toBe('string');
      expect(text).toContain('مشروع تجريبي');
      expect(text).toContain('المبيعات');
      expect(text).toContain('المصروفات');
    });
  });

  describe('buildInvoiceMessage', () => {
    it('returns string with company and amount', () => {
      const invoice = { client: 'عميل', amount: 500, dueDate: '2025-02-01' };
      const text = buildInvoiceMessage(invoice, 'شركة أ');
      expect(typeof text).toBe('string');
      expect(text).toContain('شركة أ');
      expect(text).toContain('عميل');
    });
  });
});
