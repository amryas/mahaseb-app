import { createContext, useContext, useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { initFirebase, isFirebaseEnabled, getFirebaseAuth } from '../firebase/config';
import { getSupabase, isSupabaseEnabled } from '../supabase/config';
import { clearAppCache } from '../data/store';
import { setCacheUserId } from '../data/cacheStore';
import { resetWorkspaceBootstrapState } from '../data/supabaseSync';

const AuthContext = createContext(null);
const E2E_SKIP_AUTH_KEY = 'e2e_skip_auth';
const isE2ESkipAuth = () => typeof window !== 'undefined' && localStorage.getItem(E2E_SKIP_AUTH_KEY) === '1';

/** مستخدم موحّد: إما Firebase (له .uid) أو Supabase (له .id و .email) */
function normalizeUser(firebaseUser, supabaseSession) {
  if (supabaseSession?.user) {
    const u = supabaseSession.user;
    return { id: u.id, uid: u.id, email: u.email };
  }
  if (firebaseUser) {
    return { id: firebaseUser.uid, uid: firebaseUser.uid, email: firebaseUser.email };
  }
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const firebaseActive = isFirebaseEnabled();
  const supabaseActive = isSupabaseEnabled();

  // تخطي تسجيل الدخول في اختبارات E2E
  useEffect(() => {
    if (isE2ESkipAuth()) {
      setUser({ id: 'e2e-user', uid: 'e2e-user', email: 'e2e@test.local' });
      // Ensure stable cache scope for localStorage/IndexedDB keys in E2E runs.
      setCacheUserId('e2e-user');
      setLoading(false);
    }
  }, []);

  // Supabase Auth
  useEffect(() => {
    if (isE2ESkipAuth() || !supabaseActive) return;
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      const normalized = normalizeUser(null, session);
      setUser(normalized);
      setCacheUserId(normalized?.id || null);
      setLoading(false);
    });
    sb.auth.getSession().then(({ data: { session } }) => {
      const normalized = normalizeUser(null, session);
      setUser(normalized);
      setCacheUserId(normalized?.id || null);
      setLoading(false);
    });
    return () => subscription?.unsubscribe();
  }, [supabaseActive]);

  // لو لا Firebase ولا Supabase: لا نحتاج تحميل
  useEffect(() => {
    if (!firebaseActive && !supabaseActive) setLoading(false);
  }, [firebaseActive, supabaseActive]);

  // Firebase Auth (يُستخدم فقط لو Supabase غير مفعّل)
  useEffect(() => {
    if (isE2ESkipAuth() || supabaseActive || !firebaseActive) return;
    const { auth } = initFirebase() || {};
    if (!auth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      const normalized = normalizeUser(u, null);
      setUser(normalized);
      setCacheUserId(normalized?.id || null);
      setLoading(false);
    });
    return () => unsub();
  }, [firebaseActive, supabaseActive]);

  const login = async (email, password) => {
    if (supabaseActive) {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase غير مُفعّل');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data } = await sb.auth.getSession();
      if (import.meta.env?.DEV) console.log('Supabase SESSION =', data?.session ? 'موجودة ✓' : 'غير موجودة ✗', data);
      return;
    }
    if (firebaseActive) {
      const { auth } = initFirebase() || {};
      if (!auth) throw new Error('Firebase غير مُفعّل');
      await signInWithEmailAndPassword(auth, email, password);
    }
  };

  const signup = async (email, password) => {
    if (supabaseActive) {
      const sb = getSupabase();
      if (!sb) throw new Error('Supabase غير مُفعّل');
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      const { data } = await sb.auth.getSession();
      if (import.meta.env?.DEV) console.log('Supabase SESSION بعد التسجيل =', data?.session ? 'موجودة ✓' : 'غير موجودة ✗', data);
      return;
    }
    if (firebaseActive) {
      const { auth } = initFirebase() || {};
      if (!auth) throw new Error('Firebase غير مُفعّل');
      await createUserWithEmailAndPassword(auth, email, password);
    }
  };

  const signOut = async () => {
    const uidBefore = user?.id ?? user?.uid ?? null;
    if (supabaseActive) {
      const sb = getSupabase();
      if (sb) await sb.auth.signOut();
      resetWorkspaceBootstrapState(uidBefore);
      clearAppCache();
      setUser(null);
      setCacheUserId(null);
      return;
    }
    if (firebaseActive) {
      const auth = getFirebaseAuth();
      if (auth) await firebaseSignOut(auth);
      resetWorkspaceBootstrapState(uidBefore);
      clearAppCache();
    }
    setUser(null);
    setCacheUserId(null);
  };

  const authEnabled = firebaseActive || supabaseActive;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        firebaseEnabled: firebaseActive,
        supabaseAuthEnabled: supabaseActive,
        authEnabled,
        login,
        signup,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('استخدم useAuth داخل AuthProvider');
  return ctx;
}
