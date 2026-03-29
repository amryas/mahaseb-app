import { getSettings, formatCurrency, formatDate } from '../data/store';
import { openWhatsAppWithMessage, buildInvoiceMessage } from './whatsappReport';
import { buildInvoicePageHtml, buildTableWithZebra, exportHtmlToPdfBlob } from './pdfFromHtml';
import { downloadBlob } from './downloadHelper';

function fmtMoney(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '0.00 ج.م';
  const s = x % 1 === 0 ? String(x) : x.toFixed(2);
  return s + ' ج.م';
}

/**
 * توليد فاتورة PDF (كيان الفواتير — عميل، مبلغ، استحقاق) وإرجاعها كـ Blob
 */
export async function generateInvoicePdf(invoice) {
  const paid = !!invoice.paid;
  const amount = Number(invoice.amount) || 0;
  const paidAmount = paid ? amount : 0;
  const remaining = amount - paidAmount;

  const headers = ['م', 'الوصف', 'المبلغ'];
  const rows = [[1, invoice.description || 'فاتورة', fmtMoney(amount)]];
  const tableHtml = buildTableWithZebra(headers, rows, { currencyCols: [2] });

  const summaryRows = [
    { label: 'الإجمالي النهائي', value: fmtMoney(amount) },
    { label: 'المدفوع', value: fmtMoney(paidAmount) },
    { label: 'المتبقي', value: fmtMoney(remaining) },
  ];

  const html = buildInvoicePageHtml({
    title: 'فاتورة',
    invoiceNumber: invoice.id ? String(invoice.id).slice(0, 8) : '—',
    date: formatDate(invoice.dueDate || invoice.createdAt),
    paymentStatus: paid ? 'مدفوعة' : 'غير مدفوعة',
    paymentMethod: paid ? 'نقدي' : 'آجل',
    clientName: invoice.client || '—',
    clientPhone: '—',
    clientAddress: '—',
    contentHtml: tableHtml,
    summaryRows,
    createdAt: invoice.createdAt || new Date().toISOString(),
  });

  return await exportHtmlToPdfBlob(html);
}

/**
 * تحميل الفاتورة كملف PDF
 */
export async function downloadInvoicePdf(invoice) {
  const blob = await generateInvoicePdf(invoice);
  const name = `invoice-${(invoice.client || 'فاتورة').replace(/\s/g, '-')}-${(invoice.id || '').slice(0, 8)}.pdf`;
  downloadBlob(blob, name);
}

/**
 * مشاركة الفاتورة (واتساب أو أي تطبيق) عبر Web Share إن وُجد
 */
export async function shareInvoicePdf(invoice, phoneForWhatsApp) {
  const blob = await generateInvoicePdf(invoice);
  const file = new File([blob], `invoice-${(invoice.id || '').slice(0, 8)}.pdf`, { type: 'application/pdf' });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: 'فاتورة - ' + invoice.client,
        text: `فاتورة للعميل ${invoice.client} - المبلغ ${formatCurrency(invoice.amount)}`,
        files: [file],
      });
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.warn(e);
      return false;
    }
  }

  if (phoneForWhatsApp) {
    openWhatsAppWithMessage(phoneForWhatsApp, buildInvoiceMessage(invoice));
    await downloadInvoicePdf(invoice);
    return true;
  }

  return false;
}
