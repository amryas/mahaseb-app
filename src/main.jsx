import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { validateEnvOrThrow } from './config/validateEnv'
import { logSystemEvent } from './services/monitoring'
import './index.css'

try {
  validateEnvOrThrow()
} catch (e) {
  console.error(e)
  throw e
}
import ErrorBoundary from './components/ErrorBoundary'
import { AuthProvider } from './contexts/AuthContext'
import App from './App.jsx'

const sentryDsn = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SENTRY_DSN
if (sentryDsn && typeof window !== 'undefined') {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'development',
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ maskAllText: true })],
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.1,
  })
}

if (import.meta.env.PROD && typeof window !== 'undefined') {
  const isNative = window.Capacitor?.isNativePlatform?.()
  if (!isNative) {
    import('virtual:pwa-register')
      .then((m) => {
        const SW_APPLIED_KEY = 'mohaseb_sw_update_applied';
        m.registerSW?.({
          onRegisteredSW(registration) {
            void logSystemEvent('sw_registered', 'Service Worker registered', { scope: registration?.scope || null });
          },
          onOfflineReady() {
            void logSystemEvent('sw_offline_ready', 'Offline ready (cached app shell)', {});
          },
          onNeedRefresh(registration) {
            try {
              void logSystemEvent('sw_need_refresh', 'New SW waiting; applying safe update', {});
              if (localStorage.getItem(SW_APPLIED_KEY) === '1') return;
              localStorage.setItem(SW_APPLIED_KEY, '1');

              if (registration?.waiting) {
                void logSystemEvent('sw_skip_waiting_sent', 'SKIP_WAITING message sent', {});
                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
              }

              if (navigator?.serviceWorker) {
                navigator.serviceWorker.addEventListener(
                  'controllerchange',
                  () => {
                    void logSystemEvent('sw_controller_change', 'SW controller changed; reloading', {});
                    window.location.reload();
                  },
                  { once: true }
                );
              } else {
                window.location.reload();
              }
            } catch (e) {
              void logSystemEvent('sw_update_lifecycle_failure', 'SW update lifecycle failure', { error: e?.message || 'unknown' });
            }
          },
        });
      })
      .catch(() => {});
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) {
  const err = document.createElement('div')
  err.setAttribute('style', 'padding:24px;font-family:Cairo;direction:rtl;')
  err.textContent = 'خطأ: عنصر التطبيق (root) غير موجود.'
  document.body.appendChild(err)
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  )
}
