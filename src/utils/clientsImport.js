/**
 * استخراج قائمة عملاء من صفوف Excel/CSV
 * الأعمدة المتوقعة: الاسم (مطلوب)، رقم الهاتف/الهاتف، العنوان
 */

const COL_NAME = ['الاسم', 'اسم', 'name', 'اسم العميل', 'العميل'];
const COL_PHONE = ['رقم الهاتف', 'الهاتف', 'هاتف', 'phone', 'واتساب', 'تليفون'];
const COL_ADDRESS = ['العنوان', 'عنوان', 'address', 'العنوان'];

function normalizeHeader(str) {
  if (str == null) return '';
  return String(str).trim().toLowerCase();
}

function matchColumn(header, candidates) {
  const h = normalizeHeader(header);
  for (const c of candidates) {
    const n = normalizeHeader(c);
    if (n && h === n) return true;
    if (n && h && h.includes(n)) return true;
  }
  return false;
}

/**
 * تحديد أعمدة الاسم، الهاتف، العنوان من الصف الأول
 */
export function detectClientColumns(headers) {
  const cols = { name: null, phone: null, address: null };
  headers.forEach((h, i) => {
    if (matchColumn(h, COL_NAME)) cols.name = i;
    else if (matchColumn(h, COL_PHONE)) cols.phone = i;
    else if (matchColumn(h, COL_ADDRESS)) cols.address = i;
  });
  return cols;
}

function getVal(row, index) {
  if (index == null || index < 0) return '';
  const v = row[index];
  if (v == null) return '';
  return String(v).trim();
}

/**
 * تحويل صفوف الشيت إلى مصفوفة { name, phone, address }
 * الصفوف التي لا تحتوي اسم تُتجاهل.
 */
export function parseClientsFromSheet(headers, rows) {
  if (!headers?.length && !rows?.length) return [];
  const firstRow = rows[0] || [];
  const headerRow = headers.length ? headers : firstRow;
  const dataRows = headers.length ? rows : rows.slice(1);
  const cols = detectClientColumns(headerRow);
  const result = [];
  for (const r of dataRows) {
    const name = getVal(r, cols.name);
    if (!name) continue;
    result.push({
      name,
      phone: getVal(r, cols.phone),
      address: getVal(r, cols.address),
    });
  }
  return result;
}
