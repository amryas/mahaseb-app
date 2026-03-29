import * as XLSX from 'xlsx';
import { getCategories } from '../data/store';

/** أسماء محتملة للأعمدة (عربي / إنجليزي) — مرن ليقبل ملفات Excel القديمة */
const COL_DATE = ['التاريخ', 'تاريخ', 'date', 'Date', 'يوم', 'day', 'تاري', 'تاريخ القيد', 'تاريخ الحركة'];
const COL_TYPE = ['النوع', 'نوع', 'type', 'Type', 'إيراد/مصروف', 'حركة', 'صادر/وارد', 'دائن/مدين', 'طبيعة الحركة', 'صادر', 'وارد', 'مدين', 'دائن'];
const COL_AMOUNT = ['المبلغ', 'مبلغ', 'amount', 'Amount', 'القيمة', 'قيمة', 'value', 'المجموع', 'اجمالي', 'الإجمالي', 'مبلغ الحركة', 'القيد', 'المبلغ بالجنيه', 'قيمة الحركة'];
const COL_AMOUNT_DEBIT = ['مدين', 'المبلغ المدين', 'مدين (جنيه)', 'Debit', 'المدين', 'مدين'];
const COL_AMOUNT_CREDIT = ['دائن', 'المبلغ الدائن', 'دائن (جنيه)', 'Credit', 'الدائن', 'دائن'];
const COL_DESC = ['الوصف', 'وصف', 'description', 'Description', 'البيان', 'بيان', 'تفاصيل', 'ملاحظات', 'notes', 'تفصيل', 'سبب', 'البيان', 'تفاصيل الحركة', 'ملاحظة', 'Remarks'];
const COL_CATEGORY = ['الفئة', 'فئة', 'category', 'Category', 'التصنيف', 'تصنيف', 'نوع الحركة', 'البند', 'الحساب', 'كود الحساب'];

/** إزالة التشكيل والمسافات الزائدة لتطابق مرن */
function normalizeHeader(str) {
  if (str == null) return '';
  let s = String(str).trim().toLowerCase();
  s = s.replace(/\s+/g, ' ');
  return s;
}

function matchColumn(header, candidates) {
  const h = normalizeHeader(header);
  if (!h) return false;
  for (const c of candidates) {
    const n = normalizeHeader(c);
    if (!n) continue;
    if (h === n) return true;
    if (h.includes(n) || n.includes(h)) return true;
    if (h.replace(/\s/g, '') === n.replace(/\s/g, '')) return true;
  }
  return false;
}

/**
 * إيجاد فهرس العمود المناسب من الصف الأول
 */
export function detectColumns(headers) {
  const cols = { date: null, type: null, amount: null, amountDebit: null, amountCredit: null, description: null, category: null };
  headers.forEach((h, i) => {
    if (matchColumn(h, COL_DATE)) cols.date = i;
    else if (matchColumn(h, COL_TYPE)) cols.type = i;
    else if (matchColumn(h, COL_AMOUNT_DEBIT)) cols.amountDebit = i;
    else if (matchColumn(h, COL_AMOUNT_CREDIT)) cols.amountCredit = i;
    else if (matchColumn(h, COL_AMOUNT)) cols.amount = cols.amount == null ? i : cols.amount;
    else if (matchColumn(h, COL_DESC)) cols.description = i;
    else if (matchColumn(h, COL_CATEGORY)) cols.category = i;
  });
  if (cols.amount == null && (cols.amountDebit != null || cols.amountCredit != null)) {
    cols.amount = cols.amountDebit != null ? cols.amountDebit : cols.amountCredit;
  }
  return cols;
}

/**
 * تحويل قيمة التاريخ إلى YYYY-MM-DD — يقبل تنسيقات متعددة
 */
function parseDate(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && val > 0) {
    const jsDate = new Date((val - 25569) * 86400 * 1000);
    if (!Number.isNaN(jsDate.getTime())) return jsDate.toISOString().slice(0, 10);
  }
  if (val instanceof Date && !Number.isNaN(val.getTime())) return val.toISOString().slice(0, 10);
  const ar = '٠١٢٣٤٥٦٧٨٩';
  const s = String(val).trim().replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)));
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const d = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (d) {
    const y = d[3].length === 2 ? (Number(d[3]) > 50 ? '19' + d[3] : '20' + d[3]) : d[3];
    const m = d[1].padStart(2, '0');
    const day = d[2].padStart(2, '0');
    if (Number(m) <= 12 && Number(day) <= 31) return `${y}-${m}-${day}`;
  }
  const parsed = new Date(val);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/**
 * تحديد إيراد أو مصروف من النص أو من إشارة المبلغ — مرن
 */
function parseType(val, amountNum) {
  const v = String(val || '').trim().toLowerCase();
  const incomeWords = ['إيراد', 'مدخل', 'داخل', 'income', 'وارد', 'دائن', 'ايراد', 'وارد'];
  const expenseWords = ['مصروف', 'خرج', 'expense', 'صادر', 'مدين', 'مصروفات', 'خارج'];
  if (incomeWords.some((w) => v.includes(w) || v === w)) return 'income';
  if (expenseWords.some((w) => v.includes(w) || v === w)) return 'expense';
  if (amountNum != null && amountNum < 0) return 'expense';
  return 'income';
}

function parseAmount(val) {
  if (val == null || val === '') return null;
  const num = Number(String(val).replace(/[^\d.\-]/g, '').replace(',', '.'));
  return Number.isNaN(num) ? null : Math.abs(num);
}

/**
 * قراءة ملف Excel أو CSV إلى مصفوفة صفوف (للاستخدام الداخلي)
 */
function readWorkbookToSheets(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target.result;
        const fileName = (file.name || '').toLowerCase();
        const readType = fileName.endsWith('.csv') ? 'string' : 'binary';
        const wb = XLSX.read(data, { type: readType, cellDates: true, cellNF: false, raw: false });
        if (!wb.SheetNames || !wb.SheetNames.length) {
          resolve([]);
          return;
        }
        const sheets = [];
        for (const sheetName of wb.SheetNames) {
          const ws = wb.Sheets[sheetName];
          if (!ws) continue;
          const json = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
          if (!json.length) continue;
          const rawHeaders = (json[0] || []).map((h) => (h != null ? String(h).trim() : ''));
          const rawRows = json.slice(1).filter((row) => {
            const arr = Array.isArray(row) ? row : [];
            return arr.some((cell) => cell != null && String(cell).trim() !== '');
          });
          if (rawHeaders.some((h) => h !== '') || rawRows.length > 0) {
            sheets.push({ sheetName, headers: rawHeaders, rows: rawRows });
          }
        }
        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('فشل قراءة الملف'));
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv')) {
      reader.readAsText(file, 'UTF-8');
    } else {
      reader.readAsBinaryString(file);
    }
  });
}

/**
 * قراءة ملف Excel أو CSV — مرن: يقبل .xlsx, .xls, .csv ويفتح أول ورقة فيها بيانات
 */
export function readFile(file) {
  return readWorkbookToSheets(file).then((sheets) => {
    if (sheets.length === 0) return { headers: [], rows: [] };
    const first = sheets[0];
    return { headers: first.headers, rows: first.rows };
  });
}

/**
 * استيراد ملف Excel قديم شامل: يمر على كل الأوراق، يكتشف حركات ومبيعات ويجمعها.
 * يرجع { transactions, sales, summary } لاستيرادها دفعة واحدة.
 */
export async function readFullWorkbook(file) {
  const sheets = await readWorkbookToSheets(file);
  const categories = getCategories();
  const allTransactions = [];
  const allSales = [];
  const summary = [];

  for (const { sheetName, headers, rows } of sheets) {
    const txCols = detectColumns(headers);
    const salesCols = detectColumnsForSales(headers);
    const hasAmount = txCols.amount != null;
    const hasSalesData = (salesCols.total != null) || (salesCols.unitPrice != null && salesCols.quantity != null);
    const txCount = hasAmount ? mapRowsToTransactions(rows, txCols, categories).length : 0;
    const salesCount = hasSalesData ? mapRowsToSales(rows, salesCols).length : 0;

    if (txCount > 0 && salesCount > 0) {
      if (txCount >= salesCount) {
        const tx = mapRowsToTransactions(rows, txCols, categories);
        allTransactions.push(...tx);
        summary.push({ sheetName, type: 'transactions', count: tx.length });
      } else {
        const sl = mapRowsToSales(rows, salesCols);
        allSales.push(...sl);
        summary.push({ sheetName, type: 'sales', count: sl.length });
      }
    } else if (txCount > 0) {
      const tx = mapRowsToTransactions(rows, txCols, categories);
      allTransactions.push(...tx);
      summary.push({ sheetName, type: 'transactions', count: tx.length });
    } else if (salesCount > 0) {
      const sl = mapRowsToSales(rows, salesCols);
      allSales.push(...sl);
      summary.push({ sheetName, type: 'sales', count: sl.length });
    }
  }

  return {
    transactions: allTransactions,
    sales: allSales,
    summary,
  };
}

/**
 * تحويل الصفوف إلى حركات (transactions) حسب تعيين الأعمدة
 * columnMap: { date: 0, type: 1, amount: 2, description: 3, category: 4 } (indices)
 */
export function mapRowsToTransactions(rows, columnMap, categories) {
  const result = [];
  const defaultCategory = categories.income[0];

  for (let i = 0; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const getVal = (key) => {
      const idx = columnMap[key];
      if (idx == null || idx < 0) return '';
      const v = row[idx];
      if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
      return v != null ? String(v).trim() : '';
    };

    let amountNum = parseAmount(getVal('amount'));
    let typeFromDebitCredit = null;
    if ((amountNum == null || amountNum <= 0) && (columnMap.amountDebit != null || columnMap.amountCredit != null)) {
      const debitVal = parseAmount(columnMap.amountDebit != null ? row[columnMap.amountDebit] : '');
      const creditVal = parseAmount(columnMap.amountCredit != null ? row[columnMap.amountCredit] : '');
      if (debitVal != null && debitVal > 0) {
        amountNum = debitVal;
        typeFromDebitCredit = 'expense';
      }
      if ((amountNum == null || amountNum <= 0) && creditVal != null && creditVal > 0) {
        amountNum = creditVal;
        typeFromDebitCredit = 'income';
      }
    }
    if (amountNum == null || amountNum <= 0) continue;

    let type = typeFromDebitCredit != null ? typeFromDebitCredit : parseType(getVal('type'), amountNum);
    if (typeFromDebitCredit == null && columnMap.amount === columnMap.amountDebit && columnMap.amountDebit != null) type = 'expense';
    if (typeFromDebitCredit == null && columnMap.amount === columnMap.amountCredit && columnMap.amountCredit != null) type = 'income';
    const dateStr = parseDate(getVal('date'));
    const date = dateStr || new Date().toISOString().slice(0, 10);
    const description = getVal('description') || (type === 'income' ? 'إيراد مستورد' : 'مصروف مستورد');
    let category = getVal('category');
    const list = type === 'income' ? categories.income : categories.expense;
    if (!category || !list.includes(category)) category = (list && list[0]) || (type === 'income' ? 'مبيعات' : 'أخرى');

    result.push({
      id: crypto.randomUUID(),
      type,
      description,
      amount: amountNum,
      category,
      date,
      source: 'excel_import',
    });
  }

  return result;
}

// ——— استيراد المبيعات ———
const COL_PRODUCT = ['المنتج', 'منتج', 'product', 'اسم المنتج', 'الصنف', 'صنف', 'البند', 'item', 'اسم البند', 'السلعة', 'اسم السلعة', 'وصف البند', 'Item', 'Product'];
const COL_QUANTITY = ['الكمية', 'كمية', 'quantity', 'العدد', 'عدد', 'عدد الوحدات', 'qty', 'الكمية المباعة', 'عدد الوحدات'];
const COL_UNIT_PRICE = ['سعر الوحدة', 'سعر الوحدة', 'unitprice', 'unit price', 'السعر', 'سعر', 'السعر للوحدة', 'price', 'سعر الوحدة', 'سعر البيع', 'السعر للقطعة'];
const COL_TOTAL = ['الإجمالي', 'اجمالي', 'total', 'المبلغ', 'المجموع', 'مجموع', 'المبلغ الإجمالي', 'القيمة', 'المجموع الكلي', 'قيمة الفاتورة', 'المبلغ الإجمالي', 'الإجمالي بالجنيه'];
const COL_CLIENT = ['العميل', 'عميل', 'client', 'اسم العميل', 'المشتري', 'مشتري', 'الزبون', 'زبون', 'customer', 'اسم العميل', 'العميل/المشتري'];
const COL_PAID = ['مدفوع', 'مدفوع نقداً', 'paid', 'نقدي', 'الحالة', 'حالة الدفع', 'payment', 'تم الدفع', 'نقداً', 'نقدي/آجل', 'طريقة الدفع', 'حالة السداد'];

export function detectColumnsForSales(headers) {
  const cols = { date: null, productName: null, quantity: null, unitPrice: null, total: null, clientName: null, paid: null };
  headers.forEach((h, i) => {
    if (matchColumn(h, COL_DATE)) cols.date = i;
    else if (matchColumn(h, COL_PRODUCT)) cols.productName = i;
    else if (matchColumn(h, COL_QUANTITY)) cols.quantity = i;
    else if (matchColumn(h, COL_UNIT_PRICE)) cols.unitPrice = i;
    else if (matchColumn(h, COL_TOTAL)) cols.total = i;
    else if (matchColumn(h, COL_CLIENT)) cols.clientName = i;
    else if (matchColumn(h, COL_PAID)) cols.paid = i;
  });
  return cols;
}

function parsePaid(val) {
  const v = String(val || '').trim().toLowerCase();
  if (v === 'نعم' || v === 'yes' || v === '1' || v === 'مدفوع' || v === 'نقدي' || v === 'نقداً' || v === 'تم' || v === 'دفع') return true;
  if (v === 'لا' || v === 'no' || v === '0' || v === 'آجل' || v === 'لم يدفع') return false;
  return true;
}

/**
 * تحويل صفوف Excel إلى مبيعات (لا يخصم من المخزون — للمبيعات الماضية فقط)
 */
export function mapRowsToSales(rows, columnMap) {
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : [];
    const getVal = (key) => {
      const idx = columnMap[key];
      if (idx == null || idx < 0) return '';
      const v = row[idx];
      if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
      return v != null ? String(v).trim() : '';
    };

    const totalNum = parseAmount(getVal('total'));
    const qty = parseInt(getVal('quantity'), 10) || 1;
    const unitPrice = parseAmount(getVal('unitPrice'));
    const amount = totalNum != null && totalNum > 0 ? totalNum : (unitPrice != null && unitPrice > 0 ? unitPrice * qty : null);
    if (amount == null || amount <= 0) continue;

    const productName = getVal('productName') || 'مبيعة مستوردة';
    const dateStr = parseDate(getVal('date'));
    const date = dateStr || new Date().toISOString().slice(0, 10);
    const unit = unitPrice != null && unitPrice > 0 ? unitPrice : amount / qty;
    const total = amount;
    const clientName = getVal('clientName') || 'نقدي';
    const paid = parsePaid(getVal('paid'));

    result.push({
      id: crypto.randomUUID(),
      productId: null,
      productName,
      quantity: qty,
      unitPrice: unit,
      total,
      date,
      clientName,
      paid,
      source: 'excel_import',
    });
  }
  return result;
}
