/**
 * Fail fast in development when environment pairs are inconsistent.
 * Optional vars: document in .env.example
 */
export function validateEnvOrThrow() {
  if (!import.meta.env.DEV) return;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const hasUrl = Boolean(url && String(url).trim());
  const hasKey = Boolean(key && String(key).trim());
  if (hasUrl !== hasKey) {
    throw new Error(
      '[env] Invalid configuration: set both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or omit both for offline-only dev.'
    );
  }

  const saas = import.meta.env.VITE_SAAS_API_URL;
  const saasTrim = typeof saas === 'string' ? saas.trim() : '';
  if (saasTrim) {
    try {
      new URL(saasTrim);
    } catch {
      throw new Error('[env] VITE_SAAS_API_URL must be an absolute URL when set.');
    }
  }
}
