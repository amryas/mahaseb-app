import {
  getTransactions,
  getInvoices,
  getSales,
  getPurchases,
  getDebts,
  getSettings,
  formatCurrency,
  getSaleTotal,
  getSaleProfit,
  getSaleSummary,
} from '../data/store';
import { exportHtmlToPdf, buildReportPageHtml, buildTableWithZebra } from './pdfFromHtml';

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * تصدير الحزمة الشهرية للمحاسب كـ PDF (من HTML لعرض العربية)
 * @param {string} monthStr - YYYY-MM
 */
export async function exportMonthlyPackagePdf(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const monthName = new Date(year, month - 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  const start = `${monthStr}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${monthStr}-${String(endDay).padStart(2, '0')}`;

  const transactions = getTransactions().filter((t) => t.date >= start && t.date <= end);
  const invoices = getInvoices().filter((i) => i.dueDate >= start && i.dueDate <= end);
  const sales = getSales().filter((s) => (s.status || 'completed') === 'completed' && s.date >= start && s.date <= end);
  const purchases = getPurchases().filter((p) => p.date >= start && p.date <= end);
  const debts = getDebts().filter((d) => d.dueDate >= start && d.dueDate <= end);
  const settings = getSettings();

  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const monthProfitFromSales = sales.reduce((s, x) => s + (getSaleProfit(x) ?? 0), 0);
  const netBalance = monthProfitFromSales + totalIncome - totalExpense;

  let contentHtml = `<p style="margin:0 0 16px 0;color:#475569;">الشركة: ${escapeHtml(settings.companyName || '—')} | الرقم الضريبي: ${escapeHtml(settings.companyTaxNumber || '—')}</p>
    <p style="margin:0 0 16px 0;padding:12px;background:#f8fafc;border-radius:8px;"><strong>ملخص الشهر:</strong> إجمالي الإيرادات: ${formatCurrency(totalIncome)} | إجمالي المصروفات: ${formatCurrency(totalExpense)} | ربح المبيعات: ${formatCurrency(monthProfitFromSales)} | صافي الرصيد: ${formatCurrency(netBalance)}</p>`;

  if (transactions.length > 0) {
    contentHtml += '<h2 style="margin:20px 0 8px 0;font-size:16px;color:#0f766e;">الحركات المالية</h2>';
    contentHtml += buildTableWithZebra(['التاريخ', 'النوع', 'الوصف', 'المبلغ', 'الفئة'], transactions.map((t) => [t.date ?? '', t.type === 'income' ? 'إيراد' : 'مصروف', (t.description || '').slice(0, 35), Number(t.amount) || 0, t.category ?? '']), { currencyCols: [3] });
  }
  if (invoices.length > 0) {
    contentHtml += '<h2 style="margin:20px 0 8px 0;font-size:16px;color:#0f766e;">الفواتير</h2>';
    contentHtml += buildTableWithZebra(['العميل', 'المبلغ', 'الاستحقاق', 'الحالة'], invoices.map((i) => [(i.client || '').slice(0, 25), Number(i.amount) || 0, i.dueDate ?? '', i.paid ? 'مدفوعة' : 'غير مدفوعة']), { currencyCols: [1] });
  }
  if (sales.length > 0) {
    contentHtml += '<h2 style="margin:20px 0 8px 0;font-size:16px;color:#0f766e;">المبيعات</h2>';
    contentHtml += buildTableWithZebra(['التاريخ', 'المنتج', 'الكمية', 'الإجمالي', 'العميل', 'مدفوع'], sales.map((s) => [s.date ?? '', (getSaleSummary(s) || '').slice(0, 20), Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity || 0), 0) : (s.quantity ?? ''), getSaleTotal(s) ?? 0, (s.clientName || '').slice(0, 15), s.paid ? 'نعم' : 'لا']), { currencyCols: [3] });
  }
  if (purchases.length > 0) {
    contentHtml += '<h2 style="margin:20px 0 8px 0;font-size:16px;color:#0f766e;">المشتريات</h2>';
    contentHtml += buildTableWithZebra(['التاريخ', 'المورد', 'المبلغ', 'الوصف'], purchases.map((p) => [p.date ?? '', (p.supplierName || '').slice(0, 20), Number(p.amount) || 0, (p.description || '').slice(0, 30)]), { currencyCols: [2] });
  }
  if (debts.length > 0) {
    contentHtml += '<h2 style="margin:20px 0 8px 0;font-size:16px;color:#0f766e;">الديون (ذمم مدينة)</h2>';
    contentHtml += buildTableWithZebra(['العميل', 'المبلغ', 'الاستحقاق', 'الحالة'], debts.map((d) => [(d.clientName || '').slice(0, 25), Number(d.amount) || 0, d.dueDate ?? '', d.paid ? 'مسدّد' : 'مستحق']), { currencyCols: [1] });
  }

  const html = buildReportPageHtml({ title: 'حزمة شهرية للمحاسب', subtitle: `${monthName} — من ${start} إلى ${end}`, contentHtml });
  await exportHtmlToPdf(html, `حزمة_شهرية_للمحاسب_${monthStr}.pdf`);
}

/**
 * تصدير تقرير المبيعات فقط — PDF (قالب احترافي + جدول زيبا + ملخص)
 */
export async function exportSalesReportPdf() {
  const sales = getSales().filter((s) => (s.status || 'completed') === 'completed');
  const settings = getSettings();
  const dateStr = new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  const subtitle = `${settings.companyName || 'المشروع'} — تاريخ التصدير: ${dateStr}`;
  const headers = ['التاريخ', 'المنتج/البنود', 'الكمية', 'الإجمالي', 'الربح', 'العميل', 'مدفوع'];
  const rows =
    sales.length > 0
      ? sales.map((s) => [
          s.date ?? '',
          (getSaleSummary(s) || '').slice(0, 25),
          Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity || 0), 0) : (s.quantity ?? ''),
          getSaleTotal(s) ?? 0,
          getSaleProfit(s) ?? 0,
          (s.clientName || '').slice(0, 12),
          s.paid ? 'نعم' : 'لا',
        ])
      : [];
  const totalSales = sales.reduce((s, x) => s + (getSaleTotal(x) ?? 0), 0);
  const totalProfit = sales.reduce((s, x) => s + (getSaleProfit(x) ?? 0), 0);
  const tableHtml = buildTableWithZebra(headers, rows, { currencyCols: [3, 4] });
  const summaryHtml =
    rows.length > 0
      ? `<div style="padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;max-width:320px;"><strong>الإجمالي:</strong> ${formatCurrency(totalSales)} &nbsp;|&nbsp; <strong>الربح:</strong> ${formatCurrency(totalProfit)}</div>`
      : '<p>لا توجد مبيعات.</p>';
  const html = buildReportPageHtml({ title: 'تقرير المبيعات', subtitle, contentHtml: tableHtml, summaryHtml });
  await exportHtmlToPdf(html, `تقرير_المبيعات_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * تصدير تقرير المصروفات فقط — PDF (قالب احترافي + جدول زيبا + ملخص)
 */
export async function exportExpensesReportPdf() {
  const transactions = getTransactions().filter((t) => t.type === 'expense');
  const settings = getSettings();
  const dateStr = new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  const subtitle = `${settings.companyName || 'المشروع'} — تاريخ التصدير: ${dateStr}`;
  const headers = ['التاريخ', 'الوصف', 'المبلغ', 'الفئة'];
  const rows = transactions.map((t) => [t.date ?? '', (t.description || '').slice(0, 50), Number(t.amount) || 0, t.category ?? '']);
  const total = transactions.reduce((s, t) => s + Number(t.amount || 0), 0);
  const tableHtml = buildTableWithZebra(headers, rows, { currencyCols: [2] });
  const summaryHtml =
    transactions.length > 0
      ? `<div style="padding:12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;max-width:320px;"><strong>الإجمالي:</strong> ${formatCurrency(total)}</div>`
      : '<p>لا توجد مصروفات.</p>';
  const html = buildReportPageHtml({ title: 'تقرير المصروفات', subtitle, contentHtml: tableHtml, summaryHtml });
  await exportHtmlToPdf(html, `تقرير_المصروفات_${new Date().toISOString().slice(0, 10)}.pdf`);
}
