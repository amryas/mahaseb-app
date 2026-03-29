/**
 * إعدادات جاهزة لتحويل التطبيق إلى SaaS
 * عند ربط سيرفر: ضع VITE_SAAS_API_URL في .env
 */

export const SAAS_CONFIG = {
  apiBaseUrl: import.meta.env.VITE_SAAS_API_URL || '',
  appName: import.meta.env.VITE_APP_NAME || 'محاسب مشروعي',
  isSaaS: Boolean(import.meta.env.VITE_SAAS_API_URL),
};

export function getApiUrl(path = '') {
  const base = SAAS_CONFIG.apiBaseUrl.replace(/\/$/, '');
  const p = path.replace(/^\//, '');
  return base ? `${base}/${p}` : '';
}
