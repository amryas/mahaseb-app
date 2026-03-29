import { useSyncExternalStore } from 'react';
import { getCurrentAccountId, subscribeActiveWorkspace } from '../data/store';

/**
 * معرف مساحة العمل النشطة (نفس mahaseb_current_account / المفتاح المحدد بالمستخدم).
 * يتحدّث تلقائياً بعد bootstrap تسجيل الدخول دون انتظار حالة React أخرى.
 *
 * IndexedDB يبقى مفصولاً بـ workspaceId + userId كما هو — لا يغيّر مفاتيح التخزين.
 */
export function useWorkspace() {
  const activeWorkspaceId = useSyncExternalStore(subscribeActiveWorkspace, getCurrentAccountId, getCurrentAccountId);
  return { activeWorkspaceId };
}
