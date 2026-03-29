import { Component } from 'react';
import * as Sentry from '@sentry/react';
import { getFriendlyErrorMessage } from '../utils/userErrorHandler';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info?.componentStack);
    if (typeof Sentry?.captureException === 'function') {
      Sentry.captureException(error, { extra: { componentStack: info?.componentStack } });
    }
  }

  render() {
    if (this.state.error) {
      const err = this.state.error;
      const message = getFriendlyErrorMessage(err);
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            fontFamily: 'Cairo, system-ui, sans-serif',
            background: '#f0f4f8',
            color: '#1a2332',
            direction: 'rtl',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <h1 style={{ marginBottom: 16, fontSize: '1.5rem' }}>حدث خطأ في التطبيق</h1>
          <p style={{ marginBottom: 16, fontSize: '1rem', color: '#475569' }}>
            {message}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 24,
              padding: '12px 24px',
              fontSize: '1rem',
              background: '#0d9488',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
