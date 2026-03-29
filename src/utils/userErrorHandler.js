/**
 * عرض أخطاء ودية للمستخدم — لا نعرض أبداً أخطاء Supabase / شبكة / SQL خام.
 * السجل الفعلي يُطبع في الـ console فقط.
 */

const NETWORK_PATTERNS = [
  /network/i,
  /fetch/i,
  /failed to fetch/i,
  /connection/i,
  /offline/i,
  /timeout/i,
  /ERR_NETWORK/i,
  /Load failed/i,
];

const RLS_PERMISSION_PATTERNS = [
  /RLS/i,
  /row level security/i,
  /permission denied/i,
  /policy/i,
  /401/i,
  /403/i,
  /unauthorized/i,
  /forbidden/i,
  /JWT/i,
  /session/i,
];

const NOT_FOUND_PATTERNS = [
  /could not find the table/i,
  /relation.*does not exist/i,
  /404/i,
  /not found/i,
];

/**
 * يحول أي خطأ إلى رسالة عربية ودية للمستخدم.
 * @param {Error|string|unknown} error
 * @returns {string}
 */
export function getFriendlyErrorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = error?.code ?? error?.status ?? '';

  if (!raw && !code) return 'حدث خطأ غير متوقع. حاول لاحقاً.';

  const combined = `${raw} ${code}`.toLowerCase();

  for (const p of NETWORK_PATTERNS) {
    if (p.test(combined)) return 'تعذر الاتصال بالسيرفر. تأكد من الإنترنت.';
  }
  for (const p of RLS_PERMISSION_PATTERNS) {
    if (p.test(combined)) return 'لا يمكن تنفيذ العملية الآن. حاول تسجيل الدخول مرة أخرى.';
  }
  for (const p of NOT_FOUND_PATTERNS) {
    if (p.test(combined)) return 'الخدمة غير متوفرة حالياً. حاول لاحقاً.';
  }

  return 'حدث خطأ غير متوقع. حاول لاحقاً.';
}

/**
 * طباعة الخطأ الحقيقي في الـ console فقط (للمطورين).
 * @param {Error|unknown} error
 * @param {string} [context]
 */
export function logError(error, context = '') {
  if (process.env.NODE_ENV === 'development' || typeof console !== 'undefined') {
    const prefix = context ? `[${context}]` : '';
    console.error(prefix, error);
    if (error?.stack) console.error(error.stack);
  }
}
