/**
 * تصدير PDF من HTML لعرض النص العربي بشكل صحيح (المتصفح يرسم العربية ثم نلتقطها كصورة).
 * قالب احترافي: هيدر، صندوقان، جدول زيبا، ملخص مالي، فوتر.
 */
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { downloadBlob } from './downloadHelper';
import { getSettings, formatCurrency } from '../data/store';

const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const MM_PER_PX = 25.4 / 96;

const HEADER_BG = '#0f766e';
const TABLE_HEADER_BG = '#0d9488';
const BORDER_COLOR = '#e2e8f0';
const ZEBRA_BG = '#f8fafc';

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** تنسيق رقم للعرض (بدون كسور طويلة) */
function fmtNum(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '0';
  return x % 1 === 0 ? String(x) : x.toFixed(2);
}

/** تنسيق عملة EGP */
function fmtMoney(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '0.00 ج.م';
  const s = x % 1 === 0 ? String(x) : x.toFixed(2);
  return s + ' ج.م';
}

/**
 * قالب صفحة PDF احترافية: هيدر + صندوقان (بيانات الفاتورة + العميل) + محتوى + ملخص + فوتر
 */
export function buildInvoicePageHtml(opts) {
  const settings = getSettings();
  const companyName = settings.companyName || 'المشروع';
  const logoUrl = settings.logoUrl || settings.companyLogo || '';
  const created = opts.createdAt ? new Date(opts.createdAt).toLocaleDateString('ar-EG', { dateStyle: 'long' }) : new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  const paid = opts.paymentStatus === true || opts.paymentStatus === 'مدفوعة';
  const badge = paid
    ? '<span style="display:inline-block;padding:4px 10px;background:#059669;color:#fff;border-radius:6px;font-weight:700;">مدفوعة</span>'
    : '<span style="display:inline-block;padding:4px 10px;background:#dc2626;color:#fff;border-radius:6px;font-weight:700;">غير مدفوعة</span>';

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" style="max-height:48px;max-width:120px;object-fit:contain;" />`
    : '';

  return `
<div dir="rtl" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;padding:16px 20px;color:#1e293b;">
  <header style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
    <div style="text-align:left;">${logoBlock}</div>
    <div style="text-align:right;font-size:18px;font-weight:800;color:#0f766e;">${escapeHtml(companyName)}</div>
  </header>
  <hr style="border:none;border-top:2px solid ${BORDER_COLOR};margin:8px 0 16px;" />
  <h1 style="text-align:center;font-size:22px;font-weight:800;margin:0 0 20px;color:#0f766e;">${escapeHtml(opts.title || 'فاتورة بيع')}</h1>

  <div style="display:flex;gap:20px;margin-bottom:20px;flex-wrap:wrap;">
    <div style="flex:1;min-width:200px;padding:12px;background:#f8fafc;border:1px solid ${BORDER_COLOR};border-radius:8px;">
      <div style="font-weight:700;margin-bottom:8px;color:#0f766e;">بيانات الفاتورة</div>
      <div style="font-size:13px;line-height:1.8;">رقم الفاتورة: ${escapeHtml(String(opts.invoiceNumber ?? '—'))}<br />التاريخ: ${escapeHtml(String(opts.date ?? '—'))}<br />حالة الدفع: ${badge}<br />طريقة الدفع: ${escapeHtml(String(opts.paymentMethod ?? (paid ? 'نقدي' : 'آجل')))}</div>
    </div>
    <div style="flex:1;min-width:200px;padding:12px;background:#f8fafc;border:1px solid ${BORDER_COLOR};border-radius:8px;">
      <div style="font-weight:700;margin-bottom:8px;color:#0f766e;">بيانات العميل</div>
      <div style="font-size:13px;line-height:1.8;">الاسم: ${escapeHtml(String(opts.clientName ?? '—'))}<br />الهاتف: ${escapeHtml(String(opts.clientPhone ?? '—'))}<br />العنوان: ${escapeHtml(String(opts.clientAddress ?? '—'))}</div>
    </div>
  </div>

  ${opts.contentHtml || ''}

  ${opts.summaryRows && opts.summaryRows.length ? `
  <div style="margin-top:20px;padding:14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;max-width:320px;">
    ${opts.summaryRows.map((r) => `<div style="display:flex;justify-content:space-between;margin:6px 0;"><span>${escapeHtml(r.label)}</span><strong>${escapeHtml(r.value)}</strong></div>`).join('')}
  </div>
  ` : ''}

  <footer style="margin-top:28px;padding-top:12px;border-top:1px solid ${BORDER_COLOR};text-align:center;font-size:12px;color:#64748b;">
    <div style="margin-bottom:6px;">شكرًا لتعاملكم معنا</div>
    <div>تم إنشاء هذه الفاتورة بواسطة تطبيق محاسب مشروعي — ${created}</div>
  </footer>
</div>
`;
}

/**
 * قالب تقرير PDF: هيدر + عنوان + محتوى + فوتر
 */
export function buildReportPageHtml(opts) {
  const settings = getSettings();
  const companyName = settings.companyName || 'المشروع';
  const created = new Date().toLocaleDateString('ar-EG', { dateStyle: 'long' });
  return `
<div dir="rtl" style="font-family:Segoe UI,Tahoma,Arial,sans-serif;padding:16px 20px;color:#1e293b;">
  <header style="text-align:right;margin-bottom:8px;">
    <div style="font-size:18px;font-weight:800;color:#0f766e;">${escapeHtml(companyName)}</div>
    <div style="font-size:11px;color:#64748b;">تاريخ التصدير: ${created}</div>
  </header>
  <hr style="border:none;border-top:2px solid ${BORDER_COLOR};margin:8px 0 16px;" />
  <h1 style="text-align:center;font-size:20px;font-weight:800;margin:0 0 16px;color:#0f766e;">${escapeHtml(opts.title || 'تقرير')}</h1>
  ${opts.subtitle ? `<p style="text-align:center;margin:0 0 16px;color:#64748b;font-size:13px;">${escapeHtml(opts.subtitle)}</p>` : ''}

  ${opts.contentHtml || ''}

  ${opts.summaryHtml ? `<div style="margin-top:16px;">${opts.summaryHtml}</div>` : ''}

  <footer style="margin-top:24px;padding-top:10px;border-top:1px solid ${BORDER_COLOR};text-align:center;font-size:11px;color:#64748b;">
    شكرًا لتعاملكم معنا — تم إنشاؤه بواسطة محاسب مشروعي — ${created}
  </footer>
</div>
`;
}

/**
 * إنشاء عنصر مؤقت بعرض ثابت وعرض التقرير ثم إزالته
 * @param {string} html - محتوى HTML للتقرير
 * @param {number} widthPx - عرض العنصر بالبكسل (مثلاً 794 ≈ عرض A4)
 * @returns {Promise<HTMLDivElement>}
 */
function mountReportElement(html, widthPx = 794) {
  const wrap = document.createElement('div');
  wrap.setAttribute('dir', 'rtl');
  wrap.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:0',
    `width:${widthPx}px`,
    'max-width:100%',
    'boxSizing:border-box',
    'padding:20px',
    'fontFamily:"Segoe UI", "Tahoma", "Arial", sans-serif',
    'fontSize:14px',
    'lineHeight:1.4',
    'color:#222',
    'background:#fff',
  ].join(';');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

/**
 * التقاط عنصر بـ html2canvas وإضافته لـ jsPDF (صفحة واحدة أو متعددة حسب الطول)
 * @param {HTMLElement} element
 * @param {import('jspdf').jsPDF} doc
 * @param {object} opts - { scale }
 */
async function captureToPdf(element, doc, opts = { scale: 2 }) {
  const canvas = await html2canvas(element, {
    scale: opts.scale ?? 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    logging: false,
  });
  const imgW = canvas.width;
  const imgH = canvas.height;
  const imgWMm = imgW * MM_PER_PX;
  const imgHMm = imgH * MM_PER_PX;
  const scaleToFit = Math.min(PAGE_W_MM / imgWMm, PAGE_H_MM / imgHMm);
  const pdfW = imgWMm * scaleToFit;
  const pdfH = imgHMm * scaleToFit;

  if (pdfH <= PAGE_H_MM) {
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, pdfH);
    return;
  }
  const pageH = PAGE_H_MM;
  let drawn = 0;
  let pageIndex = 0;
  while (drawn < pdfH) {
    if (pageIndex > 0) doc.addPage();
    const sliceH = Math.min(pageH, pdfH - drawn);
    const srcY = (drawn / pdfH) * imgH;
    const srcSliceH = (sliceH / pdfH) * imgH;
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = imgW;
    sliceCanvas.height = Math.ceil(srcSliceH);
    const ctx = sliceCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, srcY, imgW, srcSliceH, 0, 0, imgW, sliceCanvas.height);
    doc.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', 0, 0, pdfW, sliceH);
    drawn += sliceH;
    pageIndex++;
  }
}

/**
 * تحويل HTML إلى Blob PDF (بدون تحميل) — للاستخدام في المشاركة أو التحكم بالتحميل
 */
export async function exportHtmlToPdfBlob(html) {
  const widthPx = Math.min(794, (document.documentElement.clientWidth || 794) - 40);
  const wrap = mountReportElement(html, widthPx);
  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await captureToPdf(wrap, doc);
    return doc.output('blob');
  } finally {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }
}

/**
 * تصدير HTML كـ PDF مع دعم العربية
 * @param {string} html - محتوى التقرير (جدول + عناوين)
 * @param {string} filename - اسم الملف
 */
export async function exportHtmlToPdf(html, filename) {
  const blob = await exportHtmlToPdfBlob(html);
  if (blob && blob.size > 0) downloadBlob(blob, filename);
}

/**
 * جدول احترافي: هيدر بلون، صفوف زيبا، حدود خفيفة، أرقام بمحاذاة لليسار (في RTL)
 */
export function buildTableWithZebra(headers, rows, options = {}) {
  const { currencyCols = [] } = options; // indices that should be formatted as currency
  const thStyle = `padding:10px 8px;border:1px solid ${BORDER_COLOR};background:${TABLE_HEADER_BG};color:#fff;font-weight:700;text-align:right;`;
  const headerCells = headers.map((h) => `<th style="${thStyle}">${escapeHtml(String(h))}</th>`).join('');
  const bodyRows = rows
    .map(
      (row, i) => {
        const bg = i % 2 === 0 ? '#fff' : ZEBRA_BG;
        const cells = row.map((cell, j) => {
          const isNum = typeof cell === 'number' || (typeof cell === 'string' && /^-?[\d.,]+$/.test(cell));
          const display = currencyCols.includes(j) && isNum ? fmtMoney(cell) : (cell ?? '');
          return `<td style="padding:8px;border:1px solid ${BORDER_COLOR};background:${bg};text-align:right;">${escapeHtml(String(display))}</td>`;
        });
        return `<tr>${cells.join('')}</tr>`;
      }
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;font-family:Segoe UI,Tahoma,Arial,sans-serif;"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * بناء HTML لجدول فقط (لدمجه في صفحة أكبر) — بدون زيبا للتوافق مع الاستدعاءات القديمة
 */
export function buildTableOnly(headers, rows) {
  const headerCells = headers.map((h) => `<th style="padding:8px;border:1px solid ${BORDER_COLOR};background:${TABLE_HEADER_BG};color:#fff;">${escapeHtml(String(h))}</th>`).join('');
  const bodyRows = rows
    .map(
      (row, i) => {
        const bg = i % 2 === 0 ? '#fff' : ZEBRA_BG;
        return `<tr>${row.map((cell) => `<td style="padding:6px;border:1px solid ${BORDER_COLOR};background:${bg};">${escapeHtml(String(cell ?? ''))}</td>`).join('')}</tr>`;
      }
    )
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

/**
 * بناء HTML لجدول بسيط (عناوين + صفوف + عنوان وتذييل)
 * @param {string} title
 * @param {string} subtitle
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {string} [footer]
 */
export function buildTableHtml(title, subtitle, headers, rows, footer = '') {
  const table = buildTableOnly(headers, rows);
  const footerBlock = footer ? `<p style="margin-top:12px;font-weight:bold;">${escapeHtml(footer)}</p>` : '';
  return `
    <h1 style="margin:0 0 8px 0;font-size:20px;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 16px 0;color:#555;">${escapeHtml(subtitle)}</p>
    ${table}
    ${footerBlock}
  `;
}
