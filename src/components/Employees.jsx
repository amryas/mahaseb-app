import { useState, useEffect } from 'react';
import { getEmployees, saveEmployees, formatCurrency } from '../data/store';
import { addTransaction } from '../data/transactionsWriteService';

export default function Employees({ onToast }) {
  const [employees, setEmployees] = useState([]);
  const [name, setName] = useState('');
  const [workDays, setWorkDays] = useState('');
  const [salary, setSalary] = useState('');
  const [note, setNote] = useState('');
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    setEmployees(getEmployees());
  }, []);

  useEffect(() => {
    saveEmployees(employees);
  }, [employees]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const days = workDays === '' ? null : Number(workDays);
    const sal = salary === '' ? null : Number(salary);
    if (editingId) {
      setEmployees((prev) =>
        prev.map((p) =>
          p.id === editingId ? { ...p, name: name.trim(), workDays: days, salary: sal, note: note.trim() } : p
        )
      );
      setEditingId(null);
      onToast?.('تم تحديث بيانات الموظف');
    } else {
      setEmployees((prev) => [
        ...prev,
        { id: crypto.randomUUID(), name: name.trim(), workDays: days, salary: sal, note: note.trim() },
      ]);
      onToast?.('تمت إضافة الموظف');
    }
    setName('');
    setWorkDays('');
    setSalary('');
    setNote('');
  };

  const startEdit = (emp) => {
    setEditingId(emp.id);
    setName(emp.name || '');
    setWorkDays(emp.workDays != null ? String(emp.workDays) : '');
    setSalary(emp.salary != null ? String(emp.salary) : '');
    setNote(emp.note || '');
  };

  const handleDelete = (id) => {
    if (confirm('حذف هذا الموظف من القائمة؟')) setEmployees((prev) => prev.filter((p) => p.id !== id));
    onToast?.('تم الحذف');
  };

  const paySalary = async (emp) => {
    const amount = Number(emp.salary);
    if (!amount || amount <= 0) return;
    const tr = await addTransaction({
      id: crypto.randomUUID(),
      type: 'expense',
      description: `مرتب: ${emp.name}`,
      amount,
      category: 'رواتب',
      date: new Date().toISOString().slice(0, 10),
      source: 'salary',
      employeeId: emp.id,
    });
    if (!tr.ok) onToast?.('تعذر تسجيل صرف المرتب محلياً.', 'error');
    else onToast?.('تم تسجيل صرف المرتب');
  };

  return (
    <>
      <h1 className="page-title">الموظفين</h1>
      <p className="card-desc" style={{ marginBottom: '1rem' }}>
        إدارة الموظفين: عدد أيام الشغل، المرتب، وتسجيل صرف المرتب (يُسجّل كمصروف تلقائياً تحت فئة «رواتب»).
      </p>

      <div className="card">
        <h2 className="card-title">{editingId ? 'تعديل موظف' : 'إضافة موظف'}</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label>اسم الموظف</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>أيام الشغل (شهرياً)</label>
              <input type="number" min="0" value={workDays} onChange={(e) => setWorkDays(e.target.value)} placeholder="مثال: 26" />
            </div>
            <div className="form-group">
              <label>المرتب (ج.م)</label>
              <input type="number" min="0" step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0" />
            </div>
            <div className="form-group">
              <label>ملاحظة</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="btn-primary">{editingId ? 'حفظ التعديل' : 'إضافة موظف'}</button>
          {editingId && (
            <button type="button" className="btn-secondary" style={{ marginRight: '0.5rem' }} onClick={() => setEditingId(null)}>
              إلغاء
            </button>
          )}
        </form>
      </div>

      <div className="card">
        <h2 className="card-title">قائمة الموظفين</h2>
        {employees.length === 0 ? (
          <div className="empty-state"><p>لا يوجد موظفين مسجلين.</p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>أيام الشغل</th>
                  <th>المرتب</th>
                  <th>ملاحظة</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>{emp.name}</td>
                    <td>{emp.workDays != null ? emp.workDays : '—'}</td>
                    <td className="amount-expense">{emp.salary != null ? formatCurrency(emp.salary) : '—'}</td>
                    <td>{emp.note || '—'}</td>
                    <td className="actions-cell">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => startEdit(emp)}>تعديل</button>
                      {Number(emp.salary) > 0 && (
                        <button type="button" className="btn-primary btn-sm" onClick={() => paySalary(emp)}>صرف مرتب</button>
                      )}
                      <button type="button" className="btn-danger btn-sm" onClick={() => handleDelete(emp.id)}>حذف</button>
                    </td>
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
