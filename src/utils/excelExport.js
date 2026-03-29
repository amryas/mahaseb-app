import * as XLSX from 'xlsx';
import {
  getTransactions,
  getInvoices,
  getProducts,
  getSales,
  getDebts,
  getStockMovements,
  getClients,
  getSuppliers,
  getPurchases,
  getEmployees,
  getSettings,
  getSaleTotal,
  getSaleProfit,
  getSaleSummary,
} from '../data/store';
import { downloadBlob } from './downloadHelper';

const BOM = '\uFEFF'; // UTF-8 BOM for Excel Arabic

const FILE_NAMES = {
  sales: 'Mahaseb_Sales_Report.xlsx',
  expenses: 'Mahaseb_Expenses_Report.xlsx',
  full: 'Mahaseb_Full_Report.xlsx',
  accountant: 'Mahaseb_Accountant_Report.xlsx',
};

function downloadWorkbook(wb, filename) {
  try {
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', bookSST: false });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    if (blob.size === 0) throw new Error('ملف Excel فارغ');
    downloadBlob(blob, filename);
  } catch (e) {
    console.error('تصدير Excel:', e);
    throw e;
  }
}

/** ملخص للوحة التحكم: إجمالي مبيعات، إيرادات، مصروفات، صافي ربح، أعداد */
function getDashboardData() {
  const transactions = getTransactions();
  const completedSales = getSales().filter((s) => (s.status || 'completed') === 'completed');
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalSales = completedSales.reduce((s, x) => s + (getSaleTotal(x) ?? 0), 0);
  const salesProfit = completedSales.reduce((s, x) => s + (getSaleProfit(x) ?? 0), 0);
  const netProfit = salesProfit + totalIncome - totalExpense;
  return {
    totalSales,
    totalIncome,
    totalExpense,
    netProfit,
    productsCount: getProducts().length,
    clientsCount: getClients().length,
    invoicesCount: getInvoices().length,
    exportDate: new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' }),
    companyName: getSettings().companyName || '—',
  };
}

/** إنشاء ورقة Dashboard كأول ورقة في المصنف */
function buildDashboardSheet(data) {
  const rows = [
    ['Dashboard — ملخص'],
    [],
    ['إجمالي المبيعات (ج.م)', data.totalSales],
    ['إجمالي الإيرادات (ج.م)', data.totalIncome],
    ['إجمالي المصروفات (ج.م)', data.totalExpense],
    ['صافي الربح (ج.م)', data.netProfit],
    [],
    ['عدد المنتجات', data.productsCount],
    ['عدد العملاء', data.clientsCount],
    ['عدد الفواتير', data.invoicesCount],
    [],
    ['الشركة', data.companyName],
    ['تاريخ التصدير', data.exportDate],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', state: 'frozen' };
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }];
  return ws;
}

function setSheetColsAndFreeze(ws, colWidths) {
  if (colWidths) ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', state: 'frozen' };
}

/**
 * تصدير قائمة العملاء فقط إلى ملف Excel (.xlsx)
 * الأعمدة: الاسم، رقم الهاتف، العنوان
 */
export function exportClientsToExcel() {
  const clients = getClients();
  const rows = [
    ['الاسم', 'رقم الهاتف', 'العنوان'],
    ...clients.map((c) => [c.name || '', c.phone || '', c.address || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'العملاء');
  downloadWorkbook(wb, `عملاء_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function escapeCsv(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(arr) {
  return arr.map(escapeCsv).join(',') + '\r\n';
}

/**
 * تصدير كل العمليات إلى ملف CSV (يفتح في Excel)
 * العمود الأول: النوع (حركة، فاتورة، مبيعة، دين، منتج، حركة مخزون، عميل، مورد، مشتريات، موظف)
 */
export function exportAllToExcel() {
  const lines = [];
  const settings = getSettings();
  const company = settings.companyName || '';
  if (company) lines.push(row([`الشركة: ${company}`]));
  if (settings.companyTaxNumber) lines.push(row([`الرقم الضريبي: ${settings.companyTaxNumber}`]));
  if (settings.companyAddress) lines.push(row([`العنوان: ${settings.companyAddress}`]));
  if (company || settings.companyTaxNumber || settings.companyAddress) lines.push(row([]));

  const headers = ['النوع', 'التاريخ', 'الوصف', 'المبلغ', 'الفئة', 'تفاصيل إضافية'];

  // حركات مالية
  const transactions = getTransactions();
  lines.push(row(['=== حركات مالية (إيرادات ومصروفات) ===']));
  lines.push(row(headers));
  transactions.forEach((t) => {
    lines.push(
      row([
        t.type === 'income' ? 'إيراد' : 'مصروف',
        t.date || '',
        t.description || '',
        t.amount ?? '',
        t.category || '',
        t.source || '',
      ])
    );
  });
  lines.push(row([]));

  // فواتير
  const invoices = getInvoices();
  lines.push(row(['=== الفواتير ===']));
  lines.push(row(['العميل', 'المبلغ', 'تاريخ الاستحقاق', 'الحالة', 'الوصف']));
  invoices.forEach((i) => {
    lines.push(row([i.client, i.amount, i.dueDate, i.paid ? 'مدفوعة' : 'غير مدفوعة', i.description || '']));
  });
  lines.push(row([]));

  // مبيعات
  const sales = getSales();
  lines.push(row(['=== المبيعات ===']));
  lines.push(row(['التاريخ', 'المنتج', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'العميل', 'الحالة']));
  sales.forEach((s) => {
    const qty = Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity || 0), 0) : (s.quantity ?? 0);
    lines.push(
      row([
        s.date,
        getSaleSummary(s),
        qty,
        Array.isArray(s.items) ? '—' : (s.unitPrice ?? ''),
        getSaleTotal(s) ?? '',
        s.clientName || '',
        s.paid ? 'مدفوع' : 'آجل',
      ])
    );
  });
  lines.push(row([]));

  // ديون (ذمم مدينة)
  const debts = getDebts();
  lines.push(row(['=== الديون (ذمم مدينة) ===']));
  lines.push(row(['العميل', 'المبلغ', 'تاريخ الاستحقاق', 'الحالة', 'ملاحظة']));
  debts.forEach((d) => {
    lines.push(row([d.clientName, d.amount, d.dueDate, d.paid ? 'مسدّد' : 'مستحق', d.note || '']));
  });
  lines.push(row([]));

  // منتجات
  const products = getProducts();
  lines.push(row(['=== المخزون (المنتجات) ===']));
  lines.push(row(['المنتج', 'الكمية', 'حد التنبيه', 'الوحدة']));
  products.forEach((p) => {
    lines.push(row([p.name, p.quantity, p.minQuantity ?? 0, p.unit || 'قطعة']));
  });
  lines.push(row([]));

  // حركات مخزون
  const movements = getStockMovements();
  lines.push(row(['=== حركات المخزون ===']));
  lines.push(row(['التاريخ', 'نوع الحركة', 'الكمية', 'ملاحظة']));
  movements.forEach((m) => {
    const type = m.type === 'in' ? 'إدخال' : 'صرف';
    lines.push(row([m.date, type, m.quantity, m.note || '']));
  });
  lines.push(row([]));

  // عملاء
  const clients = getClients();
  lines.push(row(['=== العملاء ===']));
  lines.push(row(['الاسم', 'الهاتف', 'العنوان']));
  clients.forEach((c) => {
    lines.push(row([c.name || '', c.phone || '', c.address || '']));
  });
  lines.push(row([]));

  // موردين
  const suppliers = getSuppliers();
  lines.push(row(['=== الموردين ===']));
  lines.push(row(['الاسم', 'الهاتف', 'ملاحظة']));
  suppliers.forEach((s) => {
    lines.push(row([s.name || '', s.phone || '', s.note || '']));
  });
  lines.push(row([]));

  // مشتريات
  const purchases = getPurchases();
  lines.push(row(['=== المشتريات ===']));
  lines.push(row(['التاريخ', 'المورد', 'المبلغ', 'الوصف']));
  purchases.forEach((p) => {
    lines.push(row([p.date, p.supplierName || '', p.amount, p.description || '']));
  });
  lines.push(row([]));

  // موظفين
  const employees = getEmployees();
  lines.push(row(['=== الموظفين ===']));
  lines.push(row(['الاسم', 'أيام الشغل', 'المرتب', 'ملاحظة']));
  employees.forEach((e) => {
    lines.push(row([e.name || '', e.workDays ?? '', e.salary ?? '', e.note || '']));
  });

  const csv = BOM + lines.join('');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `جميع_العمليات_${new Date().toISOString().slice(0, 10)}.csv`);
}

/**
 * تصدير تقرير ربح شهري (مبيعات، تكلفة، ربح، نسبة ربح)
 * @param {string} monthStr - بصيغة YYYY-MM
 */
export function exportMonthlyProfitReport(monthStr) {
  const sales = getSales();
  const [year, month] = monthStr.split('-').map(Number);
  const monthName = new Date(year, month - 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  const start = `${monthStr}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${monthStr}-${String(endDay).padStart(2, '0')}`;
  const monthSales = sales.filter((s) => (s.status || 'completed') === 'completed' && s.date >= start && s.date <= end);
  const totalSales = monthSales.reduce((s, x) => s + getSaleTotal(x), 0);
  const totalCost = monthSales.reduce((s, x) => {
    if (Array.isArray(x.items)) return s + x.items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitCost || 0), 0);
    return s + (x.unitCost ?? 0) * (x.quantity || 0);
  }, 0);
  const totalProfit = monthSales.reduce((s, x) => s + getSaleProfit(x), 0);
  const marginPct = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  const lines = [];
  const settings = getSettings();
  if (settings.companyName) lines.push(row([`الشركة: ${settings.companyName}`]));
  lines.push(row([`تقرير ربح شهري - ${monthName}`]));
  lines.push(row([]));
  lines.push(row(['إجمالي المبيعات', 'إجمالي التكلفة', 'إجمالي الربح', 'نسبة الربح %']));
  lines.push(row([totalSales, totalCost, totalProfit, marginPct.toFixed(1)]));
  lines.push(row([]));
  lines.push(row(['التاريخ', 'المنتج', 'الكمية', 'المبلغ', 'التكلفة', 'الربح', 'نسبة الربح %']));
  monthSales.forEach((s) => {
    const stotal = getSaleTotal(s);
    const sprofit = getSaleProfit(s);
    const cost = Array.isArray(s.items)
      ? s.items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unitCost || 0), 0)
      : (s.unitCost ?? 0) * (s.quantity || 0);
    const margin = stotal > 0 ? (sprofit / stotal) * 100 : 0;
    const qty = Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity || 0), 0) : (s.quantity ?? '');
    lines.push(row([s.date, getSaleSummary(s), qty, stotal ?? '', cost, sprofit ?? '', margin.toFixed(1)]));
  });

  const csv = BOM + lines.join('');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, `تقرير_ربح_${monthStr}.csv`);
}

/**
 * حزمة شهرية للمحاسب — Excel فيه كل حركات وفواتير ومبيعات ومصروفات الشهر
 * @param {string} monthStr - بصيغة YYYY-MM
 */
export function exportMonthlyPackageExcel(monthStr) {
  const [year, month] = monthStr.split('-').map(Number);
  const monthName = new Date(year, month - 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  const start = `${monthStr}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${monthStr}-${String(endDay).padStart(2, '0')}`;

  const transactions = getTransactions().filter((t) => t.date >= start && t.date <= end);
  const invoices = getInvoices().filter((i) => i.dueDate >= start && i.dueDate <= end);
  const allSalesInMonth = getSales().filter((s) => s.date >= start && s.date <= end);
  const sales = allSalesInMonth.filter((s) => (s.status || 'completed') === 'completed');
  const purchases = getPurchases().filter((p) => p.date >= start && p.date <= end);
  const debts = getDebts().filter((d) => d.dueDate >= start && d.dueDate <= end);
  const settings = getSettings();

  const wb = XLSX.utils.book_new();

  const coverRows = [
    ['حزمة شهرية للمحاسب'],
    [`الشهر: ${monthName}`],
    [`من ${start} إلى ${end}`],
    [],
    ['الشركة:', settings.companyName || '—'],
    ['الرقم الضريبي:', settings.companyTaxNumber || '—'],
    ['العنوان:', settings.companyAddress || '—'],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(coverRows), 'الغلاف');

  const txRows = [
    ['التاريخ', 'النوع', 'الوصف', 'المبلغ', 'الفئة'],
    ...transactions.map((t) => [
      t.date,
      t.type === 'income' ? 'إيراد' : 'مصروف',
      t.description || '',
      t.amount ?? '',
      t.category || '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(txRows), 'الحركات');

  const invRows = [
    ['العميل', 'الوصف', 'المبلغ', 'تاريخ الاستحقاق', 'الحالة'],
    ...invoices.map((i) => [i.client, i.description || '', i.amount, i.dueDate, i.paid ? 'مدفوعة' : 'غير مدفوعة']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invRows), 'الفواتير');

  const salesRows = [
    ['التاريخ', 'المنتج', 'الكمية', 'سعر الوحدة', 'الإجمالي', 'العميل', 'مدفوع'],
    ...sales.map((s) => {
      const qty = Array.isArray(s.items) ? s.items.reduce((sum, i) => sum + (i.quantity || 0), 0) : (s.quantity ?? 0);
      return [
        s.date,
        getSaleSummary(s),
        qty,
        Array.isArray(s.items) ? '—' : (s.unitPrice ?? ''),
        getSaleTotal(s) ?? '',
        s.clientName || '',
        s.paid ? 'نعم' : 'لا',
      ];
    }),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salesRows), 'المبيعات');

  const purchRows = [
    ['التاريخ', 'المورد', 'المبلغ', 'الوصف'],
    ...purchases.map((p) => [p.date, p.supplierName || '', p.amount, p.description || '']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(purchRows), 'المشتريات');

  const debtRows = [
    ['العميل', 'المبلغ', 'تاريخ الاستحقاق', 'الحالة', 'ملاحظة'],
    ...debts.map((d) => [d.clientName, d.amount, d.dueDate, d.paid ? 'مسدّد' : 'مستحق', d.note || '']),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(debtRows), 'الديون');

  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const monthProfitFromSales = sales.reduce((s, x) => s + (getSaleProfit(x) ?? 0), 0);
  const netBalance = monthProfitFromSales + totalIncome - totalExpense;
  const summaryRows = [
    ['ملخص الشهر'],
    ['إجمالي الإيرادات (حركات)', totalIncome],
    ['إجمالي المصروفات', totalExpense],
    ['ربح المبيعات', monthProfitFromSales],
    ['صافي الرصيد (ربح المبيعات + إيرادات − مصروفات)', netBalance],
    [],
    ['عدد الحركات', transactions.length],
    ['عدد الفواتير', invoices.length],
    ['عدد المبيعات', sales.length],
    ['عدد المشتريات', purchases.length],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'الملخص');

  downloadWorkbook(wb, `حزمة_شهرية_للمحاسب_${monthStr}.xlsx`);
}

/**
 * التقرير الشامل — Dashboard + Sales, Expenses, Transactions, Inventory, Customers, Invoices
 */
export function exportFullReportExcel() {
  const wb = XLSX.utils.book_new();
  const dash = getDashboardData();
  XLSX.utils.book_append_sheet(wb, buildDashboardSheet(dash), 'Dashboard');

  const sales = getSales().filter((s) => (s.status || 'completed') === 'completed').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const salesHeader = ['م', 'التاريخ', 'العميل', 'البنود', 'الكمية', 'الإجمالي (ج.م)', 'الربح (ج.م)', 'مدفوع'];
  const salesRows = sales.map((s, i) => [
    i + 1,
    s.date ?? '',
    s.clientName || 'نقدي',
    (getSaleSummary(s) || '').slice(0, 50),
    Array.isArray(s.items) ? s.items.reduce((sum, it) => sum + (it.quantity || 0), 0) : (s.quantity ?? 0),
    getSaleTotal(s) ?? 0,
    getSaleProfit(s) ?? 0,
    s.paid ? 'نعم' : 'آجل',
  ]);
  const wsSales = XLSX.utils.aoa_to_sheet([salesHeader, ...salesRows]);
  setSheetColsAndFreeze(wsSales, [4, 12, 14, 22, 8, 14, 12, 6]);
  XLSX.utils.book_append_sheet(wb, wsSales, 'Sales');

  const expenses = getTransactions().filter((t) => t.type === 'expense').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const expHeader = ['م', 'التاريخ', 'الوصف', 'المبلغ (ج.م)', 'الفئة'];
  const expRows = expenses.map((t, i) => [i + 1, t.date ?? '', (t.description || '').slice(0, 40), t.amount ?? '', t.category ?? '']);
  const wsExp = XLSX.utils.aoa_to_sheet([expHeader, ...expRows]);
  setSheetColsAndFreeze(wsExp, [4, 12, 22, 14, 12]);
  XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

  const transactions = getTransactions().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const txHeader = ['م', 'التاريخ', 'النوع', 'الوصف', 'المبلغ (ج.م)', 'الفئة'];
  const txRows = transactions.map((t, i) => [i + 1, t.date ?? '', t.type === 'income' ? 'إيراد' : 'مصروف', (t.description || '').slice(0, 35), t.amount ?? '', t.category ?? '']);
  const wsTx = XLSX.utils.aoa_to_sheet([txHeader, ...txRows]);
  setSheetColsAndFreeze(wsTx, [4, 12, 8, 20, 14, 12]);
  XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');

  const products = getProducts();
  const invHeader = ['م', 'المنتج', 'الكمية', 'الوحدة', 'حد التنبيه', 'تكلفة الوحدة'];
  const invRows = products.map((p, i) => [i + 1, p.name || '', p.quantity ?? 0, p.unit || 'قطعة', p.minQuantity ?? '—', p.costPrice ?? 0]);
  const wsInv = XLSX.utils.aoa_to_sheet([invHeader, ...invRows]);
  setSheetColsAndFreeze(wsInv, [4, 24, 10, 8, 10, 14]);
  XLSX.utils.book_append_sheet(wb, wsInv, 'Inventory');

  const clients = getClients();
  const custHeader = ['م', 'الاسم', 'الهاتف', 'العنوان'];
  const custRows = clients.map((c, i) => [i + 1, c.name || '', c.phone || '', (c.address || '').slice(0, 40)]);
  const wsCust = XLSX.utils.aoa_to_sheet([custHeader, ...custRows]);
  setSheetColsAndFreeze(wsCust, [4, 20, 14, 28]);
  XLSX.utils.book_append_sheet(wb, wsCust, 'Customers');

  const invoices = getInvoices();
  const invHead = ['م', 'العميل', 'الوصف', 'المبلغ (ج.م)', 'تاريخ الاستحقاق', 'الحالة'];
  const invData = invoices.map((i, idx) => [idx + 1, i.client || '', (i.description || '').slice(0, 30), i.amount ?? '', i.dueDate ?? '', i.paid ? 'مدفوعة' : 'غير مدفوعة']);
  const wsInvoices = XLSX.utils.aoa_to_sheet([invHead, ...invData]);
  setSheetColsAndFreeze(wsInvoices, [4, 18, 18, 14, 14, 12]);
  XLSX.utils.book_append_sheet(wb, wsInvoices, 'Invoices');

  downloadWorkbook(wb, FILE_NAMES.full);
}

/**
 * تصدير شامل للمحاسب — ملف Excel احترافي بكل البيانات (حركات، مبيعات، مرتجعات، جرد، فواتير، مصروفات، ديون، مشتريات، عملاء، موردين، ملخص).
 */
export function exportAccountantFullExcel() {
  const settings = getSettings();
  const transactions = getTransactions().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const invoices = getInvoices();
  const allSales = getSales();
  const completedSales = allSales.filter((s) => (s.status || 'completed') === 'completed');
  const cancelledAndReturned = allSales.filter((s) => s.status === 'cancelled' || s.status === 'returned');
  const purchases = getPurchases();
  const debts = getDebts();
  const products = getProducts();
  const clients = getClients();
  const suppliers = getSuppliers();

  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalSalesAmount = completedSales.reduce((s, x) => s + (getSaleTotal(x) ?? 0), 0);
  const totalProfitFromSales = completedSales.reduce((s, x) => s + (getSaleProfit(x) ?? 0), 0);
  /** صافي الرصيد = ربح المبيعات + إيرادات الحركات − المصروفات */
  const netBalance = totalProfitFromSales + totalIncome - totalExpense;
  const exportDate = new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  const dateStr = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildDashboardSheet(getDashboardData()), 'Dashboard');

  const txHeader = ['م', 'التاريخ', 'النوع', 'الوصف', 'المبلغ (ج.م)', 'الفئة'];
  const txRows = transactions.map((t, i) => [
    i + 1,
    t.date ?? '',
    t.type === 'income' ? 'إيراد' : 'مصروف',
    t.description || '',
    t.amount ?? '',
    t.category || '',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([txHeader, ...txRows, [], ['الإجمالي', '', '', '', totalIncome - totalExpense, '']]), 'الحركات');

  const salesHeader = ['م', 'التاريخ', 'المنتج/البنود', 'الكمية', 'سعر الوحدة', 'الخصم', 'الإجمالي (ج.م)', 'التكلفة', 'الربح (ج.م)', 'العميل', 'مدفوع'];
  const salesRows = completedSales.map((s, i) => {
    const qty = Array.isArray(s.items) ? s.items.reduce((sum, it) => sum + (it.quantity || 0), 0) : (s.quantity ?? 0);
    const cost = Array.isArray(s.items)
      ? s.items.reduce((sum, it) => sum + (it.quantity || 0) * (it.unitCost || 0), 0)
      : (s.unitCost ?? 0) * (s.quantity || 0);
    return [
      i + 1,
      s.date ?? '',
      (getSaleSummary(s) || '').slice(0, 80),
      qty,
      Array.isArray(s.items) ? '—' : (s.unitPrice ?? ''),
      s.discount ?? 0,
      getSaleTotal(s) ?? '',
      cost,
      getSaleProfit(s) ?? '',
      s.clientName || 'نقدي',
      s.paid ? 'نعم' : 'آجل',
    ];
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([salesHeader, ...salesRows, [], ['الإجمالي', '', '', '', '', '', totalSalesAmount, '', totalProfitFromSales, '', '']]), 'المبيعات');

  const returnsHeader = ['م', 'التاريخ', 'المنتج/البنود', 'الكمية', 'المبلغ (ج.م)', 'العميل', 'الحالة'];
  const returnsRows = cancelledAndReturned.map((s, i) => [
    i + 1,
    s.date ?? '',
    (getSaleSummary(s) || '').slice(0, 80),
    Array.isArray(s.items) ? s.items.reduce((sum, it) => sum + (it.quantity || 0), 0) : (s.quantity ?? ''),
    getSaleTotal(s) ?? '',
    s.clientName || '—',
    s.status === 'cancelled' ? 'ملغى' : 'مرتجع',
  ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([returnsHeader, ...returnsRows]), 'المرتجعات والإلغاء');

  const invHeader = ['م', 'العميل', 'الوصف', 'المبلغ (ج.م)', 'تاريخ الاستحقاق', 'الحالة'];
  const invRows = invoices.map((i, idx) => [idx + 1, i.client || '', i.description || '', i.amount ?? '', i.dueDate ?? '', i.paid ? 'مدفوعة' : 'غير مدفوعة']);
  const invTotal = invoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([invHeader, ...invRows, [], ['الإجمالي', '', '', invTotal, '', '']]), 'الفواتير');

  const expenseOnly = transactions.filter((t) => t.type === 'expense').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const expenseHeader = ['م', 'التاريخ', 'الوصف', 'المبلغ (ج.م)', 'الفئة'];
  const expenseRows = expenseOnly.map((t, i) => [i + 1, t.date ?? '', t.description || '', t.amount ?? '', t.category || '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([expenseHeader, ...expenseRows, [], ['الإجمالي', '', '', totalExpense, '']]), 'المصروفات');

  const stockHeader = ['م', 'المنتج', 'الكمية', 'الوحدة', 'حد التنبيه', 'تكلفة الوحدة (ج.م)'];
  const stockRows = products.map((p, i) => [i + 1, p.name || '', p.quantity ?? 0, p.unit || 'قطعة', p.minQuantity ?? '—', p.costPrice ?? 0]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([stockHeader, ...stockRows]), 'جرد المخزون');

  const debtHeader = ['م', 'العميل', 'المبلغ (ج.م)', 'تاريخ الاستحقاق', 'الحالة', 'ملاحظة'];
  const debtRows = debts.map((d, i) => [i + 1, d.clientName || '', d.amount ?? '', d.dueDate ?? '', d.paid ? 'مسدّد' : 'مستحق', d.note || '']);
  const debtTotal = debts.reduce((s, d) => s + Number(d.amount || 0), 0);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([debtHeader, ...debtRows, [], ['الإجمالي', '', debtTotal, '', '', '']]), 'الديون');

  const purchHeader = ['م', 'التاريخ', 'المورد', 'المبلغ (ج.م)', 'الوصف'];
  const purchRows = purchases.map((p, i) => [i + 1, p.date ?? '', p.supplierName || '', p.amount ?? '', p.description || '']);
  const purchTotal = purchases.reduce((s, p) => s + Number(p.amount || 0), 0);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([purchHeader, ...purchRows, [], ['الإجمالي', '', '', purchTotal, '']]), 'المشتريات');

  const clientHeader = ['م', 'الاسم', 'الهاتف', 'العنوان'];
  const clientRows = clients.map((c, i) => [i + 1, c.name || '', c.phone || '', c.address || '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([clientHeader, ...clientRows]), 'العملاء');

  const suppHeader = ['م', 'الاسم', 'الهاتف', 'ملاحظة'];
  const suppRows = suppliers.map((s, i) => [i + 1, s.name || '', s.phone || '', s.note || '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([suppHeader, ...suppRows]), 'الموردين');

  const summaryRows = [
    ['الملخص النهائي'],
    [],
    ['إجمالي المبيعات (ج.م)', totalSalesAmount],
    ['إجمالي الإيرادات — حركات (ج.م)', totalIncome],
    ['إجمالي المصروفات (ج.م)', totalExpense],
    ['ربح المبيعات (ج.م)', totalProfitFromSales],
    ['صافي الرصيد (ج.م)', netBalance],
    [],
    ['عدد المبيعات', completedSales.length],
    ['عدد المرتجعات والإلغاء', cancelledAndReturned.length],
    ['عدد الحركات', transactions.length],
    ['عدد الفواتير', invoices.length],
    ['عدد المنتجات', products.length],
    ['عدد العملاء', clients.length],
    ['عدد الموردين', suppliers.length],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), 'الملخص');

  downloadWorkbook(wb, FILE_NAMES.accountant);
}

/**
 * تصدير تقرير المبيعات — Excel احترافي (كل الفواتير + تفصيل البنود)
 */
export function exportSalesReportExcel() {
  const sales = getSales()
    .filter((s) => (s.status || 'completed') === 'completed')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const dateStr = new Date().toISOString().slice(0, 10);
  const exportDate = new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  const settings = getSettings();
  const wb = XLSX.utils.book_new();

  const totalSales = sales.reduce((s, x) => s + (getSaleTotal(x) ?? 0), 0);
  const totalProfit = sales.reduce((s, x) => s + (getSaleProfit(x) ?? 0), 0);

  XLSX.utils.book_append_sheet(wb, buildDashboardSheet(getDashboardData()), 'Dashboard');

  const invoiceHeader = ['م', 'التاريخ', 'العميل', 'البنود (ملخص)', 'الكمية', 'الخصم', 'الإجمالي (ج.م)', 'الربح (ج.م)', 'مدفوع'];
  const invoiceRows = sales.map((s, i) => {
    const qty = Array.isArray(s.items) ? s.items.reduce((sum, it) => sum + (it.quantity || 0), 0) : (s.quantity ?? 0);
    return [
      i + 1,
      s.date ?? '',
      s.clientName || 'نقدي',
      (getSaleSummary(s) || '').slice(0, 80),
      qty,
      s.discount ?? 0,
      getSaleTotal(s) ?? 0,
      getSaleProfit(s) ?? 0,
      s.paid ? 'نعم' : 'آجل',
    ];
  });
  const wsInvoices = XLSX.utils.aoa_to_sheet([invoiceHeader, ...invoiceRows, [], ['الإجمالي', '', '', '', '', '', totalSales, totalProfit, '']]);
  setSheetColsAndFreeze(wsInvoices, [4, 12, 14, 28, 8, 8, 14, 12, 6]);
  XLSX.utils.book_append_sheet(wb, wsInvoices, 'Sales');

  const detailHeader = ['م', 'التاريخ', 'العميل', 'المنتج', 'الكمية', 'سعر الوحدة', 'إجمالي الصنف', 'التكلفة', 'ربح الصنف', 'مدفوع'];
  const detailRows = [];
  let rowNum = 1;
  sales.forEach((s) => {
    const client = s.clientName || 'نقدي';
    const paid = s.paid ? 'نعم' : 'آجل';
    if (Array.isArray(s.items) && s.items.length > 0) {
      s.items.forEach((i) => {
        const lineTotal = (i.quantity || 0) * (i.unitPrice || 0);
        const lineCost = (i.quantity || 0) * (i.unitCost || 0);
        detailRows.push([rowNum++, s.date ?? '', client, i.productName || '—', i.quantity ?? '', i.unitPrice ?? '', lineTotal, lineCost, lineTotal - lineCost, paid]);
      });
    } else {
      const lineTotal = getSaleTotal(s) ?? 0;
      const lineCost = (s.unitCost ?? 0) * (s.quantity || 0);
      detailRows.push([rowNum++, s.date ?? '', client, s.productName || '—', s.quantity ?? '', s.unitPrice ?? '', lineTotal, lineCost, getSaleProfit(s) ?? 0, paid]);
    }
  });
  const detailTotal = detailRows.length ? detailRows.reduce((acc, r) => ({ sales: acc.sales + (r[6] || 0), profit: acc.profit + (r[8] || 0) }), { sales: 0, profit: 0 }) : { sales: 0, profit: 0 };
  const wsDetail = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows, [], ['الإجمالي', '', '', '', '', '', detailTotal.sales, '', detailTotal.profit, '']]);
  setSheetColsAndFreeze(wsDetail, [4, 12, 14, 22, 8, 12, 12, 10, 10, 6]);
  XLSX.utils.book_append_sheet(wb, wsDetail, 'تفصيل البنود');

  downloadWorkbook(wb, FILE_NAMES.sales);
}

/**
 * تصدير تقرير المصروفات — Excel احترافي (كل المصروفات بالتاريخ)
 */
export function exportExpensesReportExcel() {
  const transactions = getTransactions()
    .filter((t) => t.type === 'expense')
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const dateStr = new Date().toISOString().slice(0, 10);
  const exportDate = new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  const settings = getSettings();
  const wb = XLSX.utils.book_new();
  const total = transactions.reduce((s, t) => s + Number(t.amount || 0), 0);

  XLSX.utils.book_append_sheet(wb, buildDashboardSheet(getDashboardData()), 'Dashboard');

  const header = ['م', 'التاريخ', 'الوصف', 'المبلغ (ج.م)', 'الفئة'];
  const rows = transactions.map((t, i) => [i + 1, t.date || '', t.description || '', t.amount ?? '', t.category || '']);
  const wsExp = XLSX.utils.aoa_to_sheet([header, ...rows, [], ['الإجمالي', '', '', total, '']]);
  setSheetColsAndFreeze(wsExp, [4, 12, 28, 14, 12]);
  XLSX.utils.book_append_sheet(wb, wsExp, 'Expenses');

  downloadWorkbook(wb, FILE_NAMES.expenses);
}
