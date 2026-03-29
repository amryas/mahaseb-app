import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getFriendlyErrorMessage, logError } from '../utils/userErrorHandler';
import './AuthScreen.css';

export default function AuthScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password !== confirmPassword) {
      setError('كلمة المرور غير متطابقة');
      return;
    }
    if (password.length < 6) {
      setError('كلمة المرور 6 أحرف على الأقل');
      return;
    }
    setLoading(true);
    setSignupSuccess(false);
    try {
      if (mode === 'login') await login(email, password);
      else {
        await signup(email, password);
        setSignupSuccess(true);
      }
    } catch (err) {
      logError(err, 'AuthScreen');
      const code = err?.code ?? err?.message ?? '';
      const msg =
        code === 'auth/email-already-in-use' || (typeof code === 'string' && code.includes('already'))
          ? 'البريد مستخدم بالفعل. سجّل الدخول.'
          : code === 'auth/invalid-credential' || code === 'auth/wrong-password' || (typeof code === 'string' && (code.includes('invalid') || code.includes('Invalid login')))
            ? 'بريد أو كلمة مرور غير صحيحة'
            : code === 'auth/weak-password' || (typeof code === 'string' && code.includes('password'))
              ? 'كلمة المرور ضعيفة (6 أحرف على الأقل)'
              : getFriendlyErrorMessage(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">محاسب مشروعي</h1>
        <p className="auth-subtitle">
          {mode === 'login' ? 'تسجيل الدخول لحسابك' : 'إنشاء حساب جديد'}
        </p>
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label>البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@email.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="auth-field">
            <label>كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          {mode === 'signup' && (
            <div className="auth-field">
              <label>تأكيد كلمة المرور</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          )}
          {error && <div className="auth-error">{error}</div>}
          {signupSuccess && mode === 'signup' && (
            <div className="auth-success" style={{ color: 'var(--success, #2e7d32)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              تم إنشاء الحساب. إن كان التأكيد بالبريد مفعّلاً، راجع بريدك ثم سجّل الدخول.
            </div>
          )}
          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'جاري...' : mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب'}
          </button>
        </form>
        <button
          type="button"
          className="auth-switch"
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? 'ليس لديك حساب؟ سجّل الآن' : 'لديك حساب؟ سجّل الدخول'}
        </button>
      </div>
    </div>
  );
}
