import { formatCurrency, formatDate, getSettings, getSales, getSaleTotal, getSaleProfit, getSaleSummary } from '../data/store';

const LINE = '──────────────────';

/**
 * بناء نص تقرير ملخص للإرسال عبر واتساب: المبيعات، المصروفات، صافي الربح، عدد الأوردرات
 */
export function buildSummaryReport(transactions, invoices) {
  const settings = getSettings();
  const company = settings.companyName || 'المشروع';
  const sales = getSales().filter((s) => (s.status || 'completed') === 'completed');

  const salesTotal = sales.reduce((s, t) => s + getSaleTotal(t), 0);
  const profitFromSales = sales.reduce((s, t) => s + getSaleProfit(t), 0);
  const orderCount = sales.length;
  const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const netProfit = profitFromSales + income - expense;
  const balance = income - expense;

  let text = `📊 *تقرير الملخص*\n`;
  text += `${company}\n`;
  text += `${LINE}\n`;
  text += `📅 التاريخ: ${new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' })}\n\n`;
  text += `🛒 المبيعات: ${formatCurrency(salesTotal)}\n`;
  text += `❌ المصروفات: ${formatCurrency(expense)}\n`;
  text += `💰 صافي الربح: ${formatCurrency(netProfit)}\n`;
  text += `📦 عدد الأوردرات: ${orderCount}\n`;
  if (profitFromSales !== 0) {
    const pct = (netProfit / profitFromSales) * 100;
    text += `📈 نسبة صافي الربح من ربح المبيعات: ${pct >= 0 ? '' : '−'}${Math.abs(pct).toFixed(1)}%\n`;
  }
  const unpaid = invoices.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0);
  if (unpaid > 0) text += `📄 مستحقات (فواتير غير مدفوعة): ${formatCurrency(unpaid)}\n`;
  text += `\n${LINE}\n`;

  return text;
}

/**
 * تقرير يومي للإرسال عبر واتساب
 */
export function buildDailyReport(transactions, dateStr) {
  const settings = getSettings();
  const company = settings.companyName || 'المشروع';
  const date = dateStr || new Date().toISOString().slice(0, 10);
  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('ar-EG', { dateStyle: 'long' });

  const sales = getSales().filter((s) => (s.status || 'completed') === 'completed' && s.date === date);
  const daySales = sales.reduce((s, x) => s + getSaleTotal(x), 0);
  const dayProfit = sales.reduce((s, x) => s + getSaleProfit(x), 0);
  const orderCount = sales.length;
  const tx = transactions.filter((t) => t.date === date);
  const expense = tx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const income = tx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const netProfit = dayProfit + income - expense;
  const balance = income - expense;

  let text = `📋 *الكشف اليومي*\n`;
  text += `${company}\n`;
  text += `${LINE}\n`;
  text += `📅 التاريخ: ${dateLabel}\n\n`;
  text += `🛒 مبيعات اليوم: ${formatCurrency(daySales)} (${orderCount} فاتورة)\n`;
  text += `📥 إيرادات اليوم (حركات): ${formatCurrency(income)}\n`;
  text += `📤 مصروفات اليوم: ${formatCurrency(expense)}\n`;
  text += `💰 صافي الربح: ${formatCurrency(netProfit)}\n`;
  text += `📊 صافي الرصيد (إيراد − مصروف): ${formatCurrency(balance)}\n`;
  text += `\n${LINE}\n`;
  return text;
}

/**
 * تقرير شهري
 */
export function buildMonthlyReport(transactions, invoices, year, month) {
  const settings = getSettings();
  const company = settings.companyName || 'المشروع';
  const monthName = new Date(year, month - 1).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });

  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const monthSalesList = getSales().filter((s) => (s.status || 'completed') === 'completed' && s.date && s.date.startsWith(monthStr));
  const monthSalesTotal = monthSalesList.reduce((s, x) => s + getSaleTotal(x), 0);
  const monthProfit = monthSalesList.reduce((s, x) => s + getSaleProfit(x), 0);
  const orderCount = monthSalesList.length;
  const tx = transactions.filter((t) => t.date && t.date.startsWith(monthStr));
  const income = tx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = tx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const netProfit = monthProfit + income - expense;
  const balance = income - expense;

  let text = `📅 *التقرير الشهري*\n`;
  text += `${company} - ${monthName}\n`;
  text += `${LINE}\n\n`;
  text += `🛒 المبيعات: ${formatCurrency(monthSalesTotal)}\n`;
  text += `❌ المصروفات: ${formatCurrency(expense)}\n`;
  text += `💰 صافي الربح: ${formatCurrency(netProfit)}\n`;
  text += `📦 عدد الأوردرات: ${orderCount}\n`;
  if (monthProfit !== 0) {
    const pct = (netProfit / monthProfit) * 100;
    text += `📈 نسبة صافي الربح من ربح المبيعات: ${pct >= 0 ? '' : '−'}${Math.abs(pct).toFixed(1)}%\n`;
  }
  text += `\n${LINE}\n`;
  return text;
}

/**
 * ملخص الربح (مبيعات + ربح اليوم والشهر) للإرسال بواتساب
 */
export function buildProfitSummaryForWhatsApp() {
  const settings = getSettings();
  const company = settings.companyName || 'المشروع';
  const sales = getSales().filter((s) => (s.status || 'completed') === 'completed');
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 7) + '-01';
  const todaySalesList = sales.filter((s) => s.date === today);
  const todaySales = todaySalesList.reduce((sum, s) => sum + getSaleTotal(s), 0);
  const todayProfit = todaySalesList.reduce((sum, s) => sum + getSaleProfit(s), 0);
  const monthSalesList = sales.filter((s) => s.date >= monthStart && s.date <= today);
  const monthSales = monthSalesList.reduce((sum, s) => sum + getSaleTotal(s), 0);
  const monthProfit = monthSalesList.reduce((sum, s) => sum + getSaleProfit(s), 0);
  const monthMargin = monthSales > 0 ? (monthProfit / monthSales) * 100 : 0;
  let text = `📊 *ملخص الربح*\n`;
  text += `${company}\n`;
  text += `${LINE}\n`;
  text += `📅 ${new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' })}\n\n`;
  text += `*اليوم:*\n`;
  text += `  المبيعات: ${formatCurrency(todaySales)}\n`;
  text += `  الربح: ${formatCurrency(todayProfit)}\n`;
  text += `  عدد الأوردرات: ${todaySalesList.length}\n\n`;
  text += `*الشهر:*\n`;
  text += `  المبيعات: ${formatCurrency(monthSales)}\n`;
  text += `  الربح: ${formatCurrency(monthProfit)}\n`;
  text += `  عدد الأوردرات: ${monthSalesList.length}\n`;
  text += `  نسبة الربح: ${monthMargin.toFixed(1)}%\n`;
  text += `\n${LINE}\n`;
  return text;
}

/**
 * نص رسالة فاتورة للعميل (لإرسالها عبر واتساب)
 */
export function buildInvoiceMessage(invoice, companyName) {
  const company = companyName || getSettings().companyName || 'المشروع';
  let text = `📄 *فاتورة*\n`;
  text += `${company}\n`;
  text += `${LINE}\n`;
  text += `العميل: ${invoice.client}\n`;
  text += `الوصف: ${invoice.description || '—'}\n`;
  text += `المبلغ: *${formatCurrency(invoice.amount)}*\n`;
  text += `تاريخ الاستحقاق: ${formatDate(invoice.dueDate)}\n`;
  text += `الحالة: ${invoice.paid ? 'مدفوعة ✅' : 'غير مدفوعة ⏳'}\n`;
  text += `\n${LINE}\n`;
  return text;
}

/**
 * فتح واتساب مع رسالة جاهزة (رابط wa.me)
 * @param {string} phone - رقم الهاتف (مع أو بدون 20)
 * @param {string} message - نص الرسالة
 */
export function openWhatsAppWithMessage(phone, message) {
  const normalized = (phone || '').replace(/\D/g, '');
  if (!normalized || normalized.length < 9) return;
  const withCountry = normalized.startsWith('20') ? normalized : '20' + normalized.replace(/^0/, '');
  const maxLen = 1000;
  const text = message.length > maxLen ? message.slice(0, maxLen) + '\n…' : message;
  const url = `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
  const w = window.open(url, '_blank', 'noopener');
  if (!w && window.location) window.location.href = url;
}

/**
 * بناء نص فاتورة بيع للعميل للإرسال عبر واتساب
 * بدون اسم المشروع وبدون خطوط فاصلة، مع إيموجي مناسبة
 */
export function buildSaleInvoiceForWhatsApp(sale, welcomeMessage = '') {
  let text = '';

  if (welcomeMessage && welcomeMessage.trim()) {
    text += welcomeMessage.trim() + '\n\n';
  }

  text += '📋 *فاتورة بيع*\n\n';
  text += `👤 العميل: *${sale.clientName || 'عميل'}*\n`;
  text += `📅 التاريخ: ${formatDate(sale.date)}\n\n`;

  text += '*البنود:*\n';
  let subtotal = 0;

  if (Array.isArray(sale.items) && sale.items.length > 0) {
    sale.items.forEach((i) => {
      const lineTotal = (i.quantity || 0) * (i.unitPrice || 0);
      subtotal += lineTotal;
      text += `${i.productName || 'منتج'}\n`;
      text += `  ${i.quantity || 0} × ${formatCurrency(i.unitPrice || 0)} = *${formatCurrency(lineTotal)}*\n`;
    });
  } else {
    const lineTotal = (sale.quantity || 0) * (sale.unitPrice || 0);
    subtotal = lineTotal;
    text += `${sale.productName || 'منتج'}\n`;
    text += `  ${sale.quantity || 0} × ${formatCurrency(sale.unitPrice || 0)} = *${formatCurrency(lineTotal)}*\n`;
  }

  text += '\n';
  if (subtotal > 0) {
    text += `المجموع قبل الخصم: ${formatCurrency(subtotal)}\n`;
  }
  const discount = Number(sale.discount) || 0;
  if (discount > 0) {
    text += `الخصم: - ${formatCurrency(discount)}\n`;
  }
  const total = getSaleTotal(sale);
  text += `\n💰 *الإجمالي: ${formatCurrency(total)}*\n\n`;

  if (sale.paid) {
    text += '✅ *مدفوع*\n\n';
  } else if (total > 0) {
    text += `⏳ *آجل — المتبقي: ${formatCurrency(total)}*\n`;
    text += `📅 تاريخ الاستحقاق: ${formatDate(sale.date)}\n\n`;
  }

  text += 'شكراً لتعاملكم معنا';

  return text;
}
