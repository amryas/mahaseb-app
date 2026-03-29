/**
 * تصدير فاتورة بيع (مبيعة واحدة) كـ PDF احترافية للعميل
 */
import { getSaleTotal, getSettings, getClients } from '../data/store';
import { exportHtmlToPdf, buildInvoicePageHtml, buildTableWithZebra } from './pdfFromHtml';

function fmtMoney(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '0.00 ج.م';
  const s = x % 1 === 0 ? String(x) : x.toFixed(2);
  return s + ' ج.م';
}

/**
 * توليد HTML لفاتورة بيع واحدة (مبيعة) ثم تصديرها PDF
 * @param {object} sale - كائن المبيعة من getSales (يحتوي items[], discount, paid, clientName, date)
 */
export async function exportSaleInvoicePdf(sale) {
  if (!sale) return;
  const settings = getSettings();
  const clients = getClients();
  const clientName = sale.clientName || 'نقدي';
  const client = clients.find((c) => (c.name || '').trim() === (clientName || '').trim());
  const clientPhone = client?.phone ?? '—';
  const clientAddress = client?.address ?? '—';

  const invoiceNumber = sale.id ? String(sale.id).slice(0, 8) : '—';
  const date = sale.date || new Date().toISOString().slice(0, 10);
  const paid = !!sale.paid;
  const paymentMethod = paid ? 'نقدي' : 'آجل';

  const items = Array.isArray(sale.items) && sale.items.length > 0
    ? sale.items
    : [{ productName: sale.productName || 'منتج', quantity: sale.quantity ?? 0, unitPrice: sale.unitPrice ?? 0, unitCost: sale.unitCost ?? 0 }];

  const headers = ['م', 'اسم المنتج', 'الكمية', 'سعر الوحدة', 'الخصم', 'الإجمالي'];
  const rows = [];
  let subtotal = 0;
  items.forEach((it, i) => {
    const qty = Number(it.quantity) || 0;
    const unitPrice = Number(it.unitPrice) || 0;
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;
    rows.push([
      i + 1,
      it.productName || '—',
      qty,
      fmtMoney(unitPrice),
      '—',
      fmtMoney(lineTotal),
    ]);
  });

  const discount = Number(sale.discount) || 0;
  const total = getSaleTotal(sale) ?? (subtotal - discount);
  const paidAmount = paid ? total : 0;
  const remaining = total - paidAmount;

  const tableHtml = buildTableWithZebra(headers, rows, { currencyCols: [3, 5] });

  const summaryRows = [
    { label: 'إجمالي قبل الخصم', value: fmtMoney(subtotal) },
    { label: 'الخصم', value: fmtMoney(discount) },
    { label: 'الإجمالي النهائي', value: fmtMoney(total) },
    { label: 'المدفوع', value: fmtMoney(paidAmount) },
    { label: 'المتبقي', value: fmtMoney(remaining) },
  ];

  const html = buildInvoicePageHtml({
    title: 'فاتورة بيع',
    invoiceNumber,
    date,
    paymentStatus: paid ? 'مدفوعة' : 'غير مدفوعة',
    paymentMethod,
    clientName,
    clientPhone,
    clientAddress,
    contentHtml: tableHtml,
    summaryRows,
    createdAt: date,
  });

  const filename = `فاتورة_بيع_${invoiceNumber}_${date}.pdf`;
  await exportHtmlToPdf(html, filename);
}
