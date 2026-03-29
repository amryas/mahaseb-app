import { useState, useEffect } from 'react';
import { getCurrentAccountId } from '../data/store';
import { isSupabaseEnabled } from '../supabase/config';
import {
  uploadPaymentProof,
  getPaymentProofsForWorkspace,
  getSignedProofUrl,
} from '../data/paymentProofApi';

export default function PaymentProofUpload({ onToast }) {
  const workspaceId = getCurrentAccountId();
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [proofs, setProofs] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadProofs = () => {
    if (!workspaceId || !isSupabaseEnabled()) return;
    setLoading(true);
    getPaymentProofsForWorkspace(workspaceId).then((list) => {
      setProofs(list || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    loadProofs();
  }, [workspaceId]);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f && f.type.startsWith('image/')) setFile(f);
    else setFile(null);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file || !workspaceId || !isSupabaseEnabled()) return;
    setUploading(true);
    const { id, error } = await uploadPaymentProof(workspaceId, file);
    setUploading(false);
    setFile(null);
    if (e.target?.reset) e.target.reset();
    if (error) {
      onToast?.(error, 'error');
      return;
    }
    onToast?.('تم رفع إثبات الدفع. سنراجعه قريباً.');
    loadProofs();
  };

  if (!isSupabaseEnabled() || !workspaceId) return null;

  return (
    <div className="card payment-proof-card">
      <h2 className="card-title">إثبات الدفع</h2>
      <p className="card-desc">
        بعد التحويل، ارفع لقطة شاشة أو صورة لإثبات الدفع لمراجعتها وتفعيل اشتراكك.
      </p>
      <form onSubmit={handleUpload} className="payment-proof-form">
        <div className="form-group">
          <label>اختر صورة (JPG أو PNG)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="file-input"
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={!file || uploading}
        >
          {uploading ? 'جاري الرفع...' : 'رفع إثبات الدفع'}
        </button>
      </form>
      {loading ? (
        <p className="text-muted">جاري التحميل...</p>
      ) : proofs.length > 0 ? (
        <div className="payment-proof-list">
          <h3>إثباتاتك المرفوعة</h3>
          <ul>
            {proofs.map((p) => (
              <li key={p.id} className={`payment-proof-item status-${p.status}`}>
                <span className="payment-proof-status">
                  {p.status === 'pending' && 'قيد المراجعة'}
                  {p.status === 'approved' && 'تمت الموافقة'}
                  {p.status === 'rejected' && 'مرفوض'}
                </span>
                <span className="payment-proof-date">
                  {p.created_at ? new Date(p.created_at).toLocaleDateString('ar-EG') : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
