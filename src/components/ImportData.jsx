import { useState, useCallback } from 'react';
import { getCategories } from '../data/store';
import { getFriendlyErrorMessage, logError } from '../utils/userErrorHandler';
import { readFile, detectColumns, mapRowsToTransactions, detectColumnsForSales, mapRowsToSales, readFullWorkbook } from '../utils/excelImport';
import { formatCurrency, formatDate } from '../data/store';
import { downloadBlob } from '../utils/downloadHelper';

const MODE_TRANSACTIONS = 'transactions';
const MODE_SALES = 'sales';
const MODE_FULL = 'full';

// تصدير قالب CSV للحركات
const TEMPLATE_TRANSACTIONS_CSV = '\uFEFFالتاريخ,النوع,المبلغ,الوصف,الفئة\n2024-01-15,إيراد,5000,بيع قديم,مبيعات\n2024-01-16,مصروف,500,إيجار,إيجار\n';
// تصدير قالب CSV للمبيعات
const TEMPLATE_SALES_CSV = '\uFEFFالتاريخ,المنتج,الكمية,سعر الوحدة,الإجمالي,العميل,مدفوع\n2024-01-10,منتج أ,2,100,200,عميل 1,نعم\n2024-01-11,منتج ب,1,50,50,نقدي,نعم\n';

function downloadTemplate(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename);
}

export default function ImportData({ onImport, onImportSales, onToast }) {
  const [mode, setMode] = useState(MODE_TRANSACTIONS);
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [columnMap, setColumnMap] = useState({ date: null, type: null, amount: null, description: null, category: null });
  const [salesColumnMap, setSalesColumnMap] = useState({ date: null, productName: null, quantity: null, unitPrice: null, total: null, clientName: null, paid: null });
  const [fullResult, setFullResult] = useState(null);
  const [fullLoading, setFullLoading] = useState(false);

  const categories = getCategories();

  const handleFileChange = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError('');
    setFullResult(null);
    setFile(f);
    setLoading(true);
    setFullLoading(mode === MODE_FULL);
    try {
      if (mode === MODE_FULL) {
        const result = await readFullWorkbook(f);
        setFullResult(result);
        setFullLoading(false);
        setLoading(false);
        return;
      }
      const { headers: h, rows: r } = await readFile(f);
      setHeaders(h);
      setRows(r);
      if (mode === MODE_TRANSACTIONS) {
        const detected = detectColumns(h);
        setColumnMap({
          date: detected.date !== null ? detected.date : (h.length > 0 ? 0 : null),
          type: detected.type !== null ? detected.type : (h.length > 1 ? 1 : null),
          amount: detected.amount !== null ? detected.amount : (h.length > 2 ? 2 : null),
          description: detected.description !== null ? detected.description : (h.length > 3 ? 3 : null),
          category: detected.category !== null ? detected.category : null,
        });
      } else {
        const detected = detectColumnsForSales(h);
        setSalesColumnMap({
          date: detected.date ?? (h.length > 0 ? 0 : null),
          productName: detected.productName ?? (h.length > 1 ? 1 : null),
          quantity: detected.quantity ?? (h.length > 2 ? 2 : null),
          unitPrice: detected.unitPrice ?? (h.length > 3 ? 3 : null),
          total: detected.total ?? (h.length > 4 ? 4 : null),
          clientName: detected.clientName ?? (h.length > 5 ? 5 : null),
          paid: detected.paid ?? (h.length > 6 ? 6 : null),
        });
      }
    } catch (err) {
      logError(err, 'ImportData');
      setError(getFriendlyErrorMessage(err));
      setHeaders([]);
      setRows([]);
      setFullResult(null);
    } finally {
      setLoading(false);
      setFullLoading(false);
    }
  }, [mode]);

  const setMap = (key, value) => {
    const v = value === '' ? null : parseInt(value, 10);
    setColumnMap((prev) => ({ ...prev, [key]: v }));
  };
  const setSalesMap = (key, value) => {
    const v = value === '' ? null : parseInt(value, 10);
    setSalesColumnMap((prev) => ({ ...prev, [key]: v }));
  };

  const transactions = mode === MODE_TRANSACTIONS && columnMap.amount != null && rows.length > 0
    ? mapRowsToTransactions(rows, columnMap, categories)
    : [];
  const sales = mode === MODE_SALES && (salesColumnMap.total != null || salesColumnMap.unitPrice != null) && rows.length > 0
    ? mapRowsToSales(rows, salesColumnMap)
    : [];

  const handleImportTransactions = async () => {
    if (transactions.length === 0) {
      onToast?.('لم يتم العثور على حركات صالحة. تحقق من تعيين عمود المبلغ والتاريخ.', 'error');
      return;
    }
    await onImport(transactions);
    setFile(null);
    setHeaders([]);
    setRows([]);
  };

  const handleImportSalesClick = async () => {
    if (sales.length === 0) {
      onToast?.('لم يتم العثور على مبيعات صالحة. تحقق من تعيين عمود الإجمالي أو سعر الوحدة والكمية.', 'error');
      return;
    }
    await onImportSales(sales);
    setFile(null);
    setHeaders([]);
    setRows([]);
  };

  const handleFullImport = async () => {
    if (!fullResult) return;
    const { transactions: tx, sales: sl } = fullResult;
    if (tx.length > 0) await onImport(tx);
    if (sl.length > 0) await onImportSales(sl);
    const msg = [];
    if (tx.length > 0) msg.push(`${tx.length} حركة`);
    if (sl.length > 0) msg.push(`${sl.length} مبيعة`);
    onToast?.(msg.length ? `تم استيراد ${msg.join(' و ')} بنجاح. البيانات كلها محمّلة في التطبيق.` : 'لم يُكتشف حركات أو مبيعات في الملف. تحقق من أسماء الأعمدة.');
    setFullResult(null);
    setFile(null);
  };

  return (
    <>
      <h1 className="page-title">استيراد من Excel</h1>
      <p className="card-desc" style={{ marginBottom: '1rem' }}>
        استيراد الحركات المالية (إيرادات ومصروفات) أو المبيعات الماضية من ملف Excel أو CSV.
      </p>

      <div className="tabs-nav">
        <button
          type="button"
          className={`tab-btn ${mode === MODE_FULL ? 'active' : ''}`}
          onClick={() => { setMode(MODE_FULL); setFile(null); setHeaders([]); setRows([]); setError(''); setFullResult(null); }}
        >
          ملف Excel قديم (شامل)
        </button>
        <button
          type="button"
          className={`tab-btn ${mode === MODE_TRANSACTIONS ? 'active' : ''}`}
          onClick={() => { setMode(MODE_TRANSACTIONS); setFile(null); setHeaders([]); setRows([]); setError(''); setFullResult(null); }}
        >
          إيرادات ومصروفات
        </button>
        <button
          type="button"
          className={`tab-btn ${mode === MODE_SALES ? 'active' : ''}`}
          onClick={() => { setMode(MODE_SALES); setFile(null); setHeaders([]); setRows([]); setError(''); setFullResult(null); }}
        >
          مبيعات
        </button>
      </div>

      <div className="card">
        <h2 className="card-title">
          {mode === MODE_FULL && 'رفع ملف Excel قديم (كل الأوراق)'}
          {mode === MODE_TRANSACTIONS && 'رفع ملف الإيرادات والمصروفات (Excel أو CSV)'}
          {mode === MODE_SALES && 'رفع ملف المبيعات (Excel أو CSV)'}
        </h2>
        <p className="card-desc">
          {mode === MODE_FULL && 'مناسب لملفات المحاسبة القديمة: يمر على كل أوراق الملف، يكتشف تلقائياً أوراق الحركات (إيراد/مصروف) وأوراق المبيعات، ويجمعها. يقبل أسماء أعمدة بالعربي أو الإنجليزي (التاريخ، المبلغ، البيان، المنتج، الكمية، الإجمالي، العميل...). بعد الرفع ستظهر ملخص ثم «استيراد الكل».'}
          {mode === MODE_TRANSACTIONS && 'الصف الأول = عناوين الأعمدة. يقبل أسماء بالعربي أو الإنجليزي (التاريخ، النوع، المبلغ، الوصف، الفئة). ترتيب الأعمدة غير مهم. المبلغ مطلوب؛ إن لم يوجد التاريخ يُستخدم اليوم.'}
          {mode === MODE_SALES && 'الصف الأول = أسماء الأعمدة. يقبل (التاريخ، المنتج، الكمية، سعر الوحدة، الإجمالي، العميل، مدفوع) أو ما يشبهها. ترتيب الأعمدة غير مهم. الإجمالي أو (سعر × كمية) مطلوب.'}
          {mode !== MODE_FULL && ' '}
          {mode !== MODE_FULL && (
            <button type="button" className="link-download btn-link-inline" onClick={() => downloadTemplate(mode === MODE_TRANSACTIONS ? TEMPLATE_TRANSACTIONS_CSV : TEMPLATE_SALES_CSV, mode === MODE_TRANSACTIONS ? 'قالب_حركات.csv' : 'قالب_مبيعات.csv')}>
              تحميل قالب
            </button>
          )}
        </p>
        <div className="form-group">
          <label>الملف</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="file-input"
          />
        </div>
        {(loading || fullLoading) && <p className="message message-info">جاري قراءة الملف وتحليل الأوراق...</p>}
        {error && <div className="message message-error">{error}</div>}
      </div>

      {mode === MODE_FULL && fullResult && (
        <div className="card" style={{ background: 'var(--success-bg, #e8f5e9)', border: '1px solid var(--success-border)' }}>
          <h2 className="card-title">ما تم اكتشافه في الملف</h2>
          {fullResult.summary.length === 0 ? (
            <p className="empty-state">لم يُكتشف أوراق بحركات أو مبيعات. تأكد أن الصف الأول يحتوي أسماء أعمدة (التاريخ، المبلغ، البيان، المنتج، الإجمالي، ...).</p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
                {fullResult.summary.map((s, i) => (
                  <li key={i} style={{ marginBottom: '0.5rem' }}>
                    <strong>ورقة «{s.sheetName}»:</strong> {s.type === 'transactions' ? `${s.count} حركة (إيراد/مصروف)` : `${s.count} مبيعة`}
                  </li>
                ))}
              </ul>
              <p style={{ marginBottom: '1rem' }}>
                <strong>المجموع:</strong> {fullResult.transactions.length} حركة، {fullResult.sales.length} مبيعة. اضغط «استيراد الكل» لتحميل كل البيانات في التطبيق.
              </p>
              <button type="button" className="btn-primary" onClick={handleFullImport}>
                استيراد الكل ({fullResult.transactions.length + fullResult.sales.length} سجل)
              </button>
            </>
          )}
        </div>
      )}

      {mode === MODE_TRANSACTIONS && headers.length > 0 && (
        <>
          <div className="card">
            <h2 className="card-title">تعيين الأعمدة — حركات</h2>
            <div className="column-map-grid">
              <div className="form-group">
                <label>عمود التاريخ</label>
                <select value={columnMap.date ?? ''} onChange={(e) => setMap('date', e.target.value)}>
                  <option value="">— لا يستورد —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود النوع (إيراد/مصروف)</label>
                <select value={columnMap.type ?? ''} onChange={(e) => setMap('type', e.target.value)}>
                  <option value="">— لا يستورد —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود المبلغ <span className="required">*</span></label>
                <select value={columnMap.amount ?? ''} onChange={(e) => setMap('amount', e.target.value)}>
                  <option value="">— اختر —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود الوصف</label>
                <select value={columnMap.description ?? ''} onChange={(e) => setMap('description', e.target.value)}>
                  <option value="">— لا يستورد —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود الفئة</label>
                <select value={columnMap.category ?? ''} onChange={(e) => setMap('category', e.target.value)}>
                  <option value="">— لا يستورد —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="card">
            <h2 className="card-title">معاينة الحركات ({transactions.length} حركة)</h2>
            {transactions.length === 0 ? (
              <p className="empty-state">لا توجد صفوف صالحة (تحتاج عمود مبلغ بأرقام صحيحة).</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>النوع</th>
                        <th>الوصف</th>
                        <th>الفئة</th>
                        <th>المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.slice(0, 15).map((t) => (
                        <tr key={t.id}>
                          <td>{formatDate(t.date)}</td>
                          <td><span className={`badge badge-${t.type}`}>{t.type === 'income' ? 'إيراد' : 'مصروف'}</span></td>
                          <td>{t.description}</td>
                          <td>{t.category}</td>
                          <td className={t.type === 'income' ? 'amount-income' : 'amount-expense'}>{formatCurrency(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {transactions.length > 15 && <p className="preview-more">... و {transactions.length - 15} حركة أخرى</p>}
                <div className="form-actions" style={{ marginTop: '1rem' }}>
                  <button type="button" className="btn-primary" onClick={handleImportTransactions}>
                    إضافة كل الحركات إلى التطبيق
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {mode === MODE_SALES && headers.length > 0 && (
        <>
          <div className="card">
            <h2 className="card-title">تعيين الأعمدة — مبيعات</h2>
            <p className="card-desc">المبيعات المستوردة لا تخصم من المخزون (للسجلات الماضية فقط).</p>
            <div className="column-map-grid">
              <div className="form-group">
                <label>عمود التاريخ</label>
                <select value={salesColumnMap.date ?? ''} onChange={(e) => setSalesMap('date', e.target.value)}>
                  <option value="">— اختر —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود المنتج</label>
                <select value={salesColumnMap.productName ?? ''} onChange={(e) => setSalesMap('productName', e.target.value)}>
                  <option value="">— اختر —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود الكمية</label>
                <select value={salesColumnMap.quantity ?? ''} onChange={(e) => setSalesMap('quantity', e.target.value)}>
                  <option value="">— اختر —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود سعر الوحدة</label>
                <select value={salesColumnMap.unitPrice ?? ''} onChange={(e) => setSalesMap('unitPrice', e.target.value)}>
                  <option value="">— اختياري —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود الإجمالي <span className="required">*</span></label>
                <select value={salesColumnMap.total ?? ''} onChange={(e) => setSalesMap('total', e.target.value)}>
                  <option value="">— اختر —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود العميل</label>
                <select value={salesColumnMap.clientName ?? ''} onChange={(e) => setSalesMap('clientName', e.target.value)}>
                  <option value="">— اختياري —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>عمود مدفوع (نعم/لا)</label>
                <select value={salesColumnMap.paid ?? ''} onChange={(e) => setSalesMap('paid', e.target.value)}>
                  <option value="">— افتراضي نعم —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>{h || `(عمود ${i + 1})`}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="card">
            <h2 className="card-title">معاينة المبيعات ({sales.length} مبيعة)</h2>
            {sales.length === 0 ? (
              <p className="empty-state">لا توجد صفوف صالحة. تحتاج عمود الإجمالي أو سعر الوحدة والكمية.</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>التاريخ</th>
                        <th>المنتج</th>
                        <th>الكمية</th>
                        <th>الإجمالي</th>
                        <th>العميل</th>
                        <th>مدفوع</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.slice(0, 15).map((s) => (
                        <tr key={s.id}>
                          <td>{formatDate(s.date)}</td>
                          <td>{s.productName}</td>
                          <td>{s.quantity}</td>
                          <td className="amount-income">{formatCurrency(s.total)}</td>
                          <td>{s.clientName}</td>
                          <td>{s.paid ? 'نعم' : 'آجل'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {sales.length > 15 && <p className="preview-more">... و {sales.length - 15} مبيعة أخرى</p>}
                <div className="form-actions" style={{ marginTop: '1rem' }}>
                  <button type="button" className="btn-primary" onClick={handleImportSalesClick}>
                    إضافة كل المبيعات إلى التطبيق
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
