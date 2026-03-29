import { useState, useEffect, useRef } from 'react';
import { getClients } from '../data/store';
import { getFriendlyErrorMessage, logError } from '../utils/userErrorHandler';
import { exportClientsToExcel } from '../utils/excelExport';
import { readFile } from '../utils/excelImport';
import { parseClientsFromSheet } from '../utils/clientsImport';
import { addClient, updateClient, deleteClient } from '../data/clientsWriteService';
import SectionHeader from './ui/SectionHeader';
import EmptyState from './ui/EmptyState';

export default function Clients({ onToast }) {
  const [clients, setClients] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setClients(getClients());
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const wr = await addClient({
      name: name.trim(),
      phone: (phone || '').trim(),
      address: (address || '').trim(),
    });
    if (!wr.ok) {
      onToast?.('تعذر حفظ العميل محلياً.', 'error');
      return;
    }
    setClients(getClients());
    setName('');
    setPhone('');
    setAddress('');
    onToast?.('تمت إضافة العميل');
  };

  const handleDelete = async (id) => {
    const dr = await deleteClient(id);
    if (!dr.ok) {
      onToast?.('تعذر حذف العميل محلياً.', 'error');
      return;
    }
    setClients(getClients());
    onToast?.('تم الحذف');
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditName(c.name || '');
    setEditPhone(c.phone || '');
    setEditAddress(c.address || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditPhone('');
    setEditAddress('');
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editingId || !editName.trim()) return;
    const ur = await updateClient(editingId, {
      name: editName.trim(),
      phone: (editPhone || '').trim(),
      address: (editAddress || '').trim(),
    });
    if (!ur.ok) {
      onToast?.('تعذر حفظ التعديلات محلياً.', 'error');
      return;
    }
    setClients(getClients());
    cancelEdit();
    onToast?.('تم حفظ التعديلات');
  };

  const handleImportFile = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    setImportError('');
    setImportPreview(null);
    try {
      const { headers, rows } = await readFile(file);
      const parsed = parseClientsFromSheet(headers, rows);
      if (!parsed.length) {
        setImportError('لم يتم العثور على صفوط صالحة (الاسم مطلوب). تأكد أن الملف يحتوي أعمدة: الاسم، رقم الهاتف، العنوان (أو اسم، هاتف، عنوان).');
        return;
      }
      setImportPreview(parsed);
    } catch (err) {
      logError(err, 'Clients import');
      setImportError(getFriendlyErrorMessage(err));
    }
    e.target.value = '';
  };

  const confirmImport = async () => {
    if (!importPreview?.length) return;
    const newClients = importPreview
      .map((row) => ({
        name: (row.name || '').trim(),
        phone: (row.phone || '').trim(),
        address: (row.address || '').trim(),
      }))
      .filter((c) => c.name);
    let ok = 0;
    for (const c of newClients) {
      const wr = await addClient(c);
      if (wr.ok) ok += 1;
      else break;
    }
    setClients(getClients());
    setImportPreview(null);
    if (ok < newClients.length) {
      onToast?.(`تم استيراد ${ok} من ${newClients.length} عميل. توقف الحفظ عند أول خطأ.`, 'error');
    } else {
      onToast?.(`تم استيراد ${ok} عميل`);
    }
  };

  return (
    <>
      <SectionHeader title="العملاء" subtitle="إدارة قائمة العملاء وتحديث بياناتهم." />
      <div className="card">
        <h2 className="card-title">إضافة عميل</h2>
        <p className="card-desc">سجّل الاسم ورقم الهاتف والعنوان. يمكنك اختيار العميل عند إرسال تقرير عبر واتساب من صفحة التقارير، وتصدير قائمة العملاء إلى Excel، أو استيراد عملاء من ملف Excel.</p>
        <form onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>الاسم</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسم العميل أو الشركة"
                required
              />
            </div>
            <div className="form-group">
              <label>رقم الهاتف / الواتساب</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01xxxxxxxx"
                dir="ltr"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: '1 1 100%' }}>
              <label>العنوان</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="عنوان العميل أو المنطقة"
              />
            </div>
            <div className="form-group form-group-btn">
              <label>&nbsp;</label>
              <button type="submit" className="btn-primary">إضافة</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <h2 className="card-title">استيراد عملاء من Excel</h2>
        <p className="card-desc">ارفع ملف Excel أو CSV يحتوي أعمدة: الاسم، رقم الهاتف (أو الهاتف)، العنوان. الصف الأول يمكن أن يكون عناوين الأعمدة.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />
        <button type="button" className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
          📂 اختيار ملف Excel أو CSV
        </button>
        {importError && <p className="form-error" style={{ marginTop: '0.5rem' }}>{importError}</p>}
        {importPreview && importPreview.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p><strong>معاينة ({importPreview.length} عميل):</strong></p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>الاسم</th><th>الهاتف</th><th>العنوان</th></tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      <td>{row.name || '—'}</td>
                      <td dir="ltr">{row.phone || '—'}</td>
                      <td>{row.address || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {importPreview.length > 10 && <p>... و {importPreview.length - 10} آخرين</p>}
            <div style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn-primary" onClick={confirmImport}>
                إضافة الكل ({importPreview.length}) إلى قائمة العملاء
              </button>
              <button type="button" className="btn-secondary" style={{ marginRight: '8px' }} onClick={() => setImportPreview(null)}>
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">قائمة العملاء</h2>
        {clients.length > 0 && (
          <p style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn-secondary" onClick={exportClientsToExcel}>
              📥 تصدير العملاء إلى Excel
            </button>
          </p>
        )}
        {clients.length === 0 ? (
          <EmptyState title="لا يوجد عملاء مسجلون" subtitle="أضف أول عميل من النموذج أعلاه." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>رقم الهاتف</th>
                  <th>العنوان</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    {editingId === c.id ? (
                      <>
                        <td colSpan={3}>
                          <form onSubmit={saveEdit} className="form-inline-edit">
                            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="الاسم" required />
                            <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="الهاتف" dir="ltr" />
                            <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="العنوان" />
                            <button type="submit" className="btn-primary">حفظ</button>
                            <button type="button" className="btn-secondary" onClick={cancelEdit}>إلغاء</button>
                          </form>
                        </td>
                        <td className="actions-cell" />
                      </>
                    ) : (
                      <>
                        <td>{c.name}</td>
                        <td dir="ltr">{c.phone || '—'}</td>
                        <td>{c.address || '—'}</td>
                        <td className="actions-cell">
                          <button type="button" className="btn-secondary" onClick={() => startEdit(c)} style={{ marginLeft: '4px' }}>
                            تعديل
                          </button>
                          <button type="button" className="btn-danger" onClick={() => handleDelete(c.id)}>
                            حذف
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
