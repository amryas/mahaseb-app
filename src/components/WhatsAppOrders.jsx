import { useState, useEffect } from 'react';
import {
  getWhatsappOrders,
  saveWhatsappOrders,
  getCurrentAccountId,
  formatCurrency,
  formatDate,
} from '../data/store';
import { addSale } from '../data/salesWriteService';
import { getSyncUserId } from '../data/firestoreSync';
import { fetchWhatsappOrdersFromCloud } from '../data/firestoreSync';
import { isFirebaseEnabled } from '../firebase/config';

function parseAmountFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const numbers = text.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return null;
  const parsed = numbers.map((n) => parseFloat(n)).filter((n) => n > 0);
  return parsed.length > 0 ? Math.max(...parsed) : null;
}

export default function WhatsAppOrders({ onAddAsIncome, onToast }) {
  const [orders, setOrders] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [manualAmount, setManualAmount] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refreshOrders = () => setOrders(getWhatsappOrders());

  useEffect(() => {
    refreshOrders();
  }, []);

  const handleFetchFromCloud = async () => {
    if (!isFirebaseEnabled()) {
      onToast?.('فعّل Firebase من الإعدادات أولاً', 'error');
      return;
    }
    const uid = getSyncUserId();
    const accountId = getCurrentAccountId();
    if (!uid || !accountId) {
      onToast?.('سجّل الدخول واختر الحساب', 'error');
      return;
    }
    setRefreshing(true);
    const data = await fetchWhatsappOrdersFromCloud(uid, accountId);
    setRefreshing(false);
    if (data) {
      setOrders(data);
      onToast?.(data.length ? `تم جلب ${data.length} طلب` : 'لا توجد طلبات جديدة');
    }
  };

  useEffect(() => {
    saveWhatsappOrders(orders);
  }, [orders]);

  const addOrderAsSale = async (order, amount) => {
    const amt = Number(amount) || parseAmountFromText(order.text) || 0;
    if (amt <= 0) {
      onToast?.('أدخل المبلغ أو تأكد أن الرسالة تحتوي رقماً', 'error');
      return;
    }
    const date = order.timestamp ? new Date(order.timestamp).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    const fromLabel = order.from_name || order.from || 'عميل واتساب';
    const saleId = crypto.randomUUID();
    const sale = {
      id: saleId,
      date,
      productName: 'طلب واتساب',
      quantity: 1,
      unitPrice: amt,
      total: amt,
      clientName: fromLabel,
      paid: true,
      status: 'completed',
    };
    const wr = await addSale(sale);
    if (!wr.ok) {
      onToast?.('تعذر حفظ المبيعة محلياً.', 'error');
      return;
    }
    onAddAsIncome?.({
      id: crypto.randomUUID(),
      type: 'income',
      description: `طلب واتساب - ${fromLabel}`,
      amount: amt,
      category: 'مبيعات',
      date,
      source: 'whatsapp_business',
      sourceOrderId: order.id,
      saleId,
    });
    setOrders((prev) => prev.filter((o) => o.id !== order.id));
    setAddingId(null);
    setManualAmount('');
    onToast?.('تم إضافة الطلب كإيراد ومبيعة');
  };

  const suggestedAmount = (order) => parseAmountFromText(order.text);

  return (
    <div className="whatsapp-orders-card card">
      <h2 className="card-title">
        <span className="card-title-icon">💬</span> طلبات واتساب الواردة
      </h2>
      <p className="card-desc">
        رسائل وردت من واتساب بيزنس API. أضف أي طلب كإيراد ومبيعة ثم سيُحذف من القائمة.
      </p>
      {isFirebaseEnabled() && (
        <p style={{ marginBottom: '0.75rem' }}>
          <button type="button" className="btn-secondary btn-sm" onClick={handleFetchFromCloud} disabled={refreshing}>
            {refreshing ? 'جاري التحديث...' : 'تحديث من السحابة'}
          </button>
        </p>
      )}
      {orders.length === 0 ? (
        <div className="empty-state">
          <p>لا توجد طلبات واردة. عند ربط واتساب بيزنس API واستقبال رسائل، ستظهر هنا.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>من</th>
                <th>الرسالة</th>
                <th>مقترح مبلغ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>{o.timestamp ? formatDate(new Date(o.timestamp).toISOString().slice(0, 10)) : '—'}</td>
                  <td dir="ltr">{o.from_name || o.from || '—'}</td>
                  <td className="text-break">{o.text || '—'}</td>
                  <td>
                    {suggestedAmount(o) != null ? formatCurrency(suggestedAmount(o)) : '—'}
                  </td>
                  <td className="actions-cell">
                    {addingId === o.id ? (
                      <div className="inline-add-form">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={manualAmount}
                          onChange={(e) => setManualAmount(e.target.value)}
                          placeholder="المبلغ"
                          style={{ width: '100px', marginLeft: '6px' }}
                        />
                        <button type="button" className="btn-primary btn-sm" onClick={() => addOrderAsSale(o, manualAmount)}>
                          تأكيد
                        </button>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => { setAddingId(null); setManualAmount(''); }}>
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn-primary btn-sm" onClick={() => setAddingId(o.id)}>
                        أضف كإيراد ومبيعة
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
