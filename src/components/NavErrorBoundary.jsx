import { Component } from 'react';
import * as Sentry from '@sentry/react';
import { getFriendlyErrorMessage } from '../utils/userErrorHandler';
import { logSystemEvent } from '../services/monitoring';

/**
 * Secondary boundary around main navigation / page content (does not replace root ErrorBoundary).
 */
export default class NavErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('NavErrorBoundary:', error, info?.componentStack);
    void logSystemEvent('ui_nav_crash', 'NavErrorBoundary caught render error', {
      message: error?.message || 'unknown',
    });
    if (typeof Sentry?.captureException === 'function') {
      Sentry.captureException(error, { extra: { componentStack: info?.componentStack, boundary: 'nav' } });
    }
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      const message = getFriendlyErrorMessage(err);
      return (
        <div className="card" style={{ margin: '1rem', direction: 'rtl', textAlign: 'center' }}>
          <h2 className="card-title">تعذر عرض هذه الصفحة</h2>
          <p className="card-desc">{message}</p>
          <button type="button" className="btn-primary" style={{ marginTop: '0.75rem' }} onClick={() => this.setState({ error: null })}>
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
