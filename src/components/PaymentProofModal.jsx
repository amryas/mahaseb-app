import { useEffect, useMemo, useState } from 'react';
import { X, UploadCloud, ShieldCheck, Phone, CreditCard, Info } from 'lucide-react';
import { getCurrentAccountId } from '../data/store';
import { isSupabaseEnabled } from '../supabase/config';
import { uploadPaymentProof } from '../data/paymentProofApi';
import { logSystemEvent } from '../services/monitoring';

function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function PaymentProofModal({ open, onClose, onToast }) {
  const workspaceId = getCurrentAccountId();
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setNote('');
      setUploading(false);
    }
  }, [open]);

  const canUse = !!open && !!workspaceId && isSupabaseEnabled();

  const helper = useMemo(() => {
    if (!isSupabaseEnabled()) return 'خدمة الدفع غير متاحة حالياً.';
    if (!workspaceId) return 'لا توجد مساحة عمل محددة.';
    return '';
  }, [workspaceId]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={() => onClose?.()}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-white/10 bg-[#111827] text-white shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-base font-black text-white">إرسال إثبات الدفع</h2>
            <p className="mt-1 text-xs text-gray-400">ارفع صورة التحويل وسيتم التفعيل خلال دقائق.</p>
          </div>
          <button
            type="button"
            className="rounded-xl bg-white/5 p-2 text-gray-300 ring-1 ring-white/10 transition-all duration-200 hover:bg-white/10"
            onClick={() => onClose?.()}
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/10">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f2937] ring-1 ring-white/10">
                  <Phone className="h-4 w-4 text-saas-primary" />
                </span>
                <div>
                  <div className="text-xs font-bold text-gray-300">📱 فودافون كاش</div>
                  <div className="mt-1 font-black text-white" dir="ltr">
                    01080697611
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#1f2937] ring-1 ring-white/10">
                  <CreditCard className="h-4 w-4 text-gray-200" />
                </span>
                <div>
                  <div className="text-xs font-bold text-gray-300">💳 InstaPay</div>
                  <div className="mt-1 font-black text-white" dir="ltr">
                    01149490291
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-[#1f2937]/80 p-3 text-sm text-gray-200 ring-1 ring-white/10">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 text-gray-400" />
                <div className="space-y-1">
                  <div>
                    <strong>1-</strong> حوّل مبلغ الاشتراك
                  </div>
                  <div>
                    <strong>2-</strong> اضغط «رفع إثبات الدفع»
                  </div>
                  <div>
                    <strong>3-</strong> سيتم التفعيل خلال دقائق
                  </div>
                </div>
              </div>
            </div>
          </div>

          {!!helper && (
            <div className="rounded-xl bg-rose-950/40 p-3 text-sm text-rose-200 ring-1 ring-rose-500/35">{helper}</div>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!canUse || !file) return;
              setUploading(true);
              try {
                const { id, error } = await uploadPaymentProof(workspaceId, file);
                if (error) {
                  onToast?.(error, 'error');
                  return;
                }
                if (note.trim()) {
                  void logSystemEvent(
                    'payment_proof_note',
                    'User attached note to payment proof',
                    { proofId: id, note: note.trim().slice(0, 300) },
                    { force: true, workspaceId }
                  );
                }
                onToast?.('تم رفع إثبات الدفع. سنراجعه قريباً.');
                onClose?.();
              } catch (err) {
                onToast?.('تعذر رفع الإثبات. حاول مرة أخرى.', 'error');
              } finally {
                setUploading(false);
              }
            }}
            className="space-y-3"
          >
            <div>
              <label className="text-sm font-bold text-gray-100">اختر صورة التحويل</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && f.type.startsWith('image/')) setFile(f);
                  else setFile(null);
                }}
                className="mt-2 block w-full rounded-xl border border-white/10 bg-[#1f2937] p-2 text-sm text-white file:mr-2 file:rounded-lg file:border-0 file:bg-saas-primary file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-saas-shell"
              />
              <div className="mt-1 text-xs text-gray-400">JPG / PNG / WEBP</div>
            </div>

            <div>
              <label className="text-sm font-bold text-gray-100">ملاحظة (اختياري)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="مثال: اسم المحول أو آخر 4 أرقام من الرقم..."
                className="mt-2 w-full rounded-xl border border-white/10 bg-[#1f2937] p-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-saas-primary/40"
              />
            </div>

            <button
              type="submit"
              className={cn(
                'w-full rounded-2xl px-4 py-3 text-sm font-black text-white transition-all duration-200 active:scale-[0.99]',
                'bg-saas-primary shadow-lg shadow-saas-primary/25 hover:bg-saas-primary-hover disabled:opacity-50'
              )}
              disabled={!canUse || !file || uploading}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <UploadCloud className="h-4 w-4" />
                {uploading ? 'جاري الرفع…' : 'رفع إثبات الدفع'}
              </span>
            </button>

            <div className="flex items-start gap-2 rounded-xl bg-emerald-950/35 p-3 text-xs text-emerald-200 ring-1 ring-emerald-500/30">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-saas-primary" />
              <div>بياناتك آمنة، ويمكنك الإلغاء في أي وقت.</div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
