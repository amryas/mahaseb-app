/**
 * API إثباتات الدفع — رفع من المستخدم، وعرض/موافقة/رفض من الأدمن.
 */

import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { logSystemEvent } from '../services/monitoring';

const BUCKET = 'payment-proofs';

/** رفع صورة إثبات دفع لمساحة العمل */
export async function uploadPaymentProof(workspaceId, file) {
  if (!workspaceId || !file || !isSupabaseEnabled()) return { id: null, error: 'غير متاح' };
  const sb = getSupabase();
  if (!sb) return { id: null, error: 'الاتصال غير متاح' };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { id: null, error: 'يجب تسجيل الدخول' };

  const ext = file.name?.split('.').pop() || 'jpg';
  const path = `${workspaceId}/${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await sb.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) return { id: null, error: uploadError.message };

  const { data: row, error: insertError } = await sb
    .from('payment_proofs')
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      image_url: path,
      status: 'pending',
    })
    .select('id')
    .single();

  if (insertError) return { id: null, error: insertError.message };
  void logSystemEvent(
    'payment_proof_uploaded',
    'User uploaded payment proof',
    { proofId: row?.id, workspaceId },
    { force: true, workspaceId }
  );
  return { id: row?.id, error: null };
}

/** قائمة إثباتات الدفع لمساحة العمل (للمستخدم) */
export async function getPaymentProofsForWorkspace(workspaceId) {
  if (!workspaceId || !isSupabaseEnabled()) return [];
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('payment_proofs')
    .select('id, image_url, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

/** قائمة إثباتات معلقة (للأدمن) */
export async function getPendingPaymentProofs() {
  if (!isSupabaseEnabled()) return [];
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('payment_proofs')
    .select('id, workspace_id, user_id, image_url, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return [];
  return data || [];
}

/**
 * تحديث حالة إثبات (موافقة/رفض) — للأدمن.
 * @param {string} proofId
 * @param {'approved'|'rejected'} status
 * @param {{ approvedBy?: string|null, approvedAt?: string }} [audit] — يُخزَّن إن وُجدت الأعمدة في قاعدة البيانات
 */
export async function updatePaymentProofStatus(proofId, status, audit = null) {
  if (!proofId || !['approved', 'rejected'].includes(status) || !isSupabaseEnabled()) return { ok: false, error: 'غير صالح' };
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'الاتصال غير متاح' };
  let patch = { status };
  if (audit && status === 'approved') {
    patch = {
      ...patch,
      approved_at: audit.approvedAt || new Date().toISOString(),
      ...(audit.approvedBy ? { approved_by: audit.approvedBy } : {}),
    };
  }
  let { error } = await sb.from('payment_proofs').update(patch).eq('id', proofId);
  if (error && status === 'approved' && audit && Object.keys(patch).length > 1) {
    const second = await sb.from('payment_proofs').update({ status }).eq('id', proofId);
    error = second.error;
  }
  return { ok: !error, error: error?.message || null };
}

/** الحصول على رابط موقع لعرض الصورة (دلو خاص) */
export async function getSignedProofUrl(imagePath, expiresIn = 3600) {
  if (!imagePath || !isSupabaseEnabled()) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.storage.from(BUCKET).createSignedUrl(imagePath, expiresIn);
  return data?.signedUrl || null;
}
